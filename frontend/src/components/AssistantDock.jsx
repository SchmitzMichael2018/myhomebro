import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, ClipboardCopy, PanelRightClose, PanelRightOpen, Sparkles, Wand2 } from "lucide-react";

import StartWithAIAssistant from "./StartWithAIAssistant.jsx";
import { saferAssistantActionLabel } from "./ProjectAssistantExperience.jsx";
import ProjectAssistantQuickCapture from "./ProjectAssistantQuickCapture.jsx";
import { buildAiContext } from "../lib/aiContext.js";
import { checkJobHealth } from "../lib/jobHealthMonitor.js";
import { draftCheckIn, draftSignatureFollowUp, draftMilestoneUpdate } from "../lib/actionDrafter.js";
import api from "../api.js";

const AssistantDockContext = createContext({
  openAssistant: () => {},
  closeAssistant: () => {},
  toggleAssistant: () => {},
  minimizeAssistant: () => {},
  updateAssistantContext: () => {},
  updateAssistantOnAction: () => {},
  isOpen: false,
  isMinimized: false,
});

function workspaceModeForRoute(route = "") {
  const path = String(route || "").toLowerCase();
  if (path.includes("/admin")) return "admin";
  if (path.includes("/disputes")) return "disputes";
  if (path.includes("/warrant")) return "warranty";
  if (path.includes("/team") || path.includes("/assignments") || path.includes("/schedule")) return "team";
  if (path.includes("/estimates") || path.includes("/proposals")) return "estimates";
  if (path.includes("/customers") || path.includes("/customer-portal")) return "customer_portal";
  if (path.includes("/properties") || path.includes("/property") || path.includes("/maintenance")) return "property_management";
  if (path.includes("/marketing") || path.includes("/public-presence")) return "marketing";
  if (path.includes("/insights") || path.includes("/business")) return "insights";
  if (path.includes("/documents") || path.includes("/photos")) return "documents";
  if (path.includes("/templates")) return "templates";
  if (path.includes("/agreements") && path.includes("/wizard")) return "agreement_wizard";
  if (path.includes("/agreements")) return "agreements";
  if (path.includes("/milestones")) return "milestones";
  if (path.includes("/invoices") || path.includes("/payments")) {
    return "invoices";
  }
  if (path.includes("/dashboard")) return "dashboard";
  if (path.includes("/opportunities") || path.includes("/bids")) return "leads";
  return "general";
}

function defaultAssistantPanelForWorkspace(workspaceMode = "general") {
  if (workspaceMode === "agreement_wizard") {
    return {
      headline: "Review this agreement draft",
      helperText:
        "Get help creating the agreement, improving scope, planning milestones, checking funding and signature readiness, and preparing invoice or payment next steps.",
      statusText: "Agreement creation context loaded",
      promptPlaceholder:
        'Examples: "Improve this scope" or "Help me check milestone and signature readiness."',
      nextActionText:
        "Next: Review agreement details, milestones, funding, signatures, and payment workflow readiness.",
      nextGuidanceTitle: "Agreement creation guidance",
      nextGuidance:
        "Project Assistant is checking the draft agreement, milestone structure, funding state, signatures, amendments, invoices, and payment workflow steps.",
    };
  }

  if (workspaceMode === "templates") {
    return {
      headline: "Review this template workflow",
      helperText:
        "Get template-aware guidance for reusable scope, workflow profile, milestones, pricing, timing, and materials.",
      statusText: "Template workspace context loaded",
      promptPlaceholder:
        'Examples: "Improve this workflow profile" or "Suggest reusable exclusions."',
      nextActionText: "Next: Review reusable workflow structure before saving or publishing.",
      nextGuidanceTitle: "Workflow intelligence",
      nextGuidance:
        "Project Assistant is checking reusable workflow structure, not agreement signature or funding readiness.",
    };
  }

  if (workspaceMode === "agreements") {
    return {
      headline: "Review this agreement",
      helperText:
        "Get help with agreement scope, milestones, funding, signatures, amendments, invoices, and payment workflow readiness.",
      statusText: "Agreement workspace context loaded",
      promptPlaceholder:
        'Examples: "Review this agreement" or "Help me check milestone and signature readiness."',
      nextActionText:
        "Next: Review the agreement, milestone, funding, signature, and payment workflow details.",
      nextGuidanceTitle: "Agreement guidance",
      nextGuidance:
        "Project Assistant is checking agreement readiness, milestone structure, funding, signatures, amendments, invoices, and payment workflow steps.",
    };
  }

  if (workspaceMode === "milestones") {
    return {
      headline: "Review milestones",
      helperText:
        "Get help sequencing milestones, pricing checkpoints, completion evidence, and invoice readiness.",
      statusText: "Milestone workspace context loaded",
      promptPlaceholder:
        'Examples: "Review milestone readiness" or "Help me sequence these checkpoints."',
      nextActionText: "Next: Review milestone sequence, completion criteria, and invoice readiness.",
      nextGuidanceTitle: "Milestone guidance",
      nextGuidance:
        "Project Assistant is checking schedule, completion evidence, approvals, and invoice handoff.",
    };
  }

  if (workspaceMode === "invoices") {
    return {
      headline: "Review payments",
      helperText:
        "Get help with invoice readiness, funding state, approvals, payouts, and dispute-safe payment steps.",
      statusText: "Payment workspace context loaded",
      promptPlaceholder:
        'Examples: "Review this invoice" or "Show payment status."',
      nextActionText: "Next: Review payment status, approvals, funding, and payout workflow.",
      nextGuidanceTitle: "Payment guidance",
      nextGuidance:
        "Project Assistant is checking invoice approval, funding, escrow or direct-pay state, payout readiness, and dispute context.",
    };
  }

  if (workspaceMode === "dashboard") {
    return {
      headline: "Review dashboard priorities",
      helperText:
        "Get help triaging active agreements, leads, milestones, invoices, and customer follow-up.",
      statusText: "Dashboard context loaded",
      promptPlaceholder:
        'Examples: "What needs attention today?" or "Help me prioritize open work."',
      nextActionText: "Next: Review active work, blockers, and follow-up priorities.",
      nextGuidanceTitle: "Dashboard guidance",
      nextGuidance: "Project Assistant is checking cross-workspace priorities and next actions.",
    };
  }

  if (workspaceMode === "disputes") {
    return {
      headline: "Review this dispute",
      helperText:
        "Get help reviewing dispute evidence, summarizing history, explaining agreement requirements, suggesting next steps, and preparing escalation guidance.",
      statusText: "Dispute workspace context loaded",
      promptPlaceholder:
        'Examples: "Summarize dispute history" or "What evidence should I review next?"',
      nextActionText:
        "Next: Review evidence, agreement requirements, timeline, and escalation options.",
      nextGuidanceTitle: "Dispute resolution guidance",
      nextGuidance:
        "Project Assistant is prepared to help review dispute evidence, summarize history, explain agreement requirements, suggest next steps, and outline escalation guidance.",
    };
  }

  if (workspaceMode === "estimates") {
    return {
      headline: "Review this estimate",
      helperText:
        "Get help checking scope, line items, pricing confidence, missing details, and agreement handoff readiness.",
      statusText: "Estimate context loaded",
      promptPlaceholder:
        'Examples: "Review estimate readiness" or "What is missing before agreement handoff?"',
      nextActionText: "Next: Review estimate readiness and handoff blockers.",
      nextGuidanceTitle: "Estimate guidance",
      nextGuidance:
        "Project Assistant is checking estimate scope, line items, incidentals, schedule assumptions, and agreement handoff readiness.",
    };
  }

  if (workspaceMode === "warranty") {
    return {
      headline: "Review warranty records",
      helperText:
        "Get help reviewing warranty evidence, missing information, possible coverage issues, and next review steps.",
      statusText: "Warranty context loaded",
      promptPlaceholder:
        'Examples: "Review warranty evidence" or "What information is missing?"',
      nextActionText: "Next: Review warranty evidence and human decision points.",
      nextGuidanceTitle: "Warranty guidance",
      nextGuidance:
        "Project Assistant can summarize warranty records and prepare review guidance, but humans decide coverage and repairs.",
    };
  }

  if (workspaceMode === "team") {
    return {
      headline: "Review team planning",
      helperText:
        "Get help checking crew fit, capability gaps, schedule conflicts, and assignment readiness.",
      statusText: "Team context loaded",
      promptPlaceholder:
        'Examples: "Review crew fit" or "What assignment risks exist?"',
      nextActionText: "Next: Review team recommendations before assigning work.",
      nextGuidanceTitle: "Team guidance",
      nextGuidance:
        "Project Assistant can recommend crew options, but humans approve all assignments and messages.",
    };
  }

  if (workspaceMode === "customer_portal") {
    return {
      headline: "Explain customer next steps",
      helperText:
        "Get plain-language guidance for approvals, payments, documents, requests, and project status.",
      statusText: "Customer context loaded",
      promptPlaceholder:
        'Examples: "What does this approval mean?" or "What happens next?"',
      nextActionText: "Next: Review the customer-facing status and options.",
      nextGuidanceTitle: "Customer guide",
      nextGuidance:
        "Project Assistant explains options without pressuring approvals, payments, signatures, or disputes.",
    };
  }

  if (workspaceMode === "property_management") {
    return {
      headline: "Review property operations",
      helperText:
        "Get help summarizing properties, units, tenant requests, work orders, documents, and maintenance next steps.",
      statusText: "Property management context loaded",
      promptPlaceholder:
        'Examples: "Review open tenant requests" or "What property records are missing?"',
      nextActionText: "Next: Review property records, requests, and work order routing.",
      nextGuidanceTitle: "Property guidance",
      nextGuidance:
        "Project Assistant can prepare routing guidance and messages, but humans approve scheduling, assignments, and customer/tenant messages.",
    };
  }

  if (workspaceMode === "marketing") {
    return {
      headline: "Review marketing presence",
      helperText:
        "Get help improving website copy, SEO, reviews, portfolio, QR campaigns, and lead generation.",
      statusText: "Marketing context loaded",
      promptPlaceholder:
        'Examples: "Improve this headline" or "What should I fix before publishing?"',
      nextActionText: "Next: Review marketing content, evidence, and publishing readiness.",
      nextGuidanceTitle: "Marketing guidance",
      nextGuidance:
        "Project Assistant can prepare marketing suggestions, but publishing and customer messages require approval.",
    };
  }

  if (workspaceMode === "insights") {
    return {
      headline: "Review business performance",
      helperText:
        "Get help interpreting metrics, patterns, risks, and operational next steps.",
      statusText: "Insights context loaded",
      promptPlaceholder:
        'Examples: "What changed this month?" or "Where is performance slipping?"',
      nextActionText: "Next: Review metrics, evidence, and recommended investigations.",
      nextGuidanceTitle: "Operations analysis",
      nextGuidance:
        "Project Assistant explains patterns and recommends investigations, while humans decide business actions.",
    };
  }

  if (workspaceMode === "documents") {
    return {
      headline: "Review documents",
      helperText:
        "Get help summarizing documents, photos, versions, missing records, and source context.",
      statusText: "Document context loaded",
      promptPlaceholder:
        'Examples: "Summarize these documents" or "What is missing?"',
      nextActionText: "Next: Review document sources and missing records.",
      nextGuidanceTitle: "Document guidance",
      nextGuidance:
        "Project Assistant can summarize records, but humans approve sending, signing, replacing, or archiving documents.",
    };
  }

  if (workspaceMode === "admin") {
    return {
      headline: "Review admin workspace",
      helperText:
        "Get help reviewing marketplace operations, contractor records, support issues, templates, and administrative next steps.",
      statusText: "Admin workspace context loaded",
      promptPlaceholder:
        'Examples: "Review marketplace issues" or "Help me find contractor records."',
      nextActionText: "Next: Review admin priorities, records, and operational follow-up.",
      nextGuidanceTitle: "Admin guidance",
      nextGuidance:
        "Project Assistant is checking administrative context, routing, contractor records, marketplace health, and support follow-up.",
    };
  }

  return {
    headline: "Tell me what you want to do",
    helperText: "Use AI to guide the next step in your workflow.",
    statusText: "Workspace context loaded",
    promptPlaceholder: 'Examples: "Help me review this page" or "What should I do next?"',
    nextActionText: "Next: Review the suggested update and continue when you're ready.",
    nextGuidanceTitle: "What happens next",
    nextGuidance: "",
  };
}

function buildRouteContext(location) {
  const currentRoute = `${location.pathname}${location.search || ""}`;
  const workspaceMode = workspaceModeForRoute(currentRoute);
  const aiContext = buildAiContext({ page: workspaceMode });
  return {
    current_route: currentRoute,
    page: workspaceMode,
    workspace_mode: workspaceMode,
    ai_panel: defaultAssistantPanelForWorkspace(workspaceMode),
    navigation_assist: buildNavigationAssistContext(workspaceMode),
    aiContext,
  };
}

function copilotLabelForRoute(route = "") {
  const workspaceMode = workspaceModeForRoute(route);
  if (workspaceMode === "agreement_wizard") return "Project Assistant for Agreement Creation";
  if (workspaceMode === "agreements") return "Project Assistant for Agreements";
  if (workspaceMode === "estimates") return "Project Assistant for Estimates";
  if (workspaceMode === "milestones") return "Project Assistant for Milestones";
  if (workspaceMode === "invoices") return "Project Assistant for Payments";
  if (workspaceMode === "templates") return "Project Assistant for Templates";
  if (workspaceMode === "disputes") return "Project Assistant for Dispute Resolution";
  if (workspaceMode === "warranty") return "Project Assistant for Warranty";
  if (workspaceMode === "team") return "Project Assistant for Team";
  if (workspaceMode === "customer_portal") return "Project Assistant for Customer Portal";
  if (workspaceMode === "property_management") return "Project Assistant for Property Management";
  if (workspaceMode === "marketing") return "Project Assistant for Marketing";
  if (workspaceMode === "insights") return "Project Assistant for Insights";
  if (workspaceMode === "documents") return "Project Assistant for Documents";
  if (workspaceMode === "admin") return "Project Assistant for Admin";
  if (workspaceMode === "leads") return "Project Assistant for Leads";
  if (workspaceMode === "dashboard") return "Project Assistant for Dashboard";
  return "Project Assistant";
}

function buildNavigationAssistContext(workspaceMode = "general") {
  const commonActions = [
    { label: "Open Templates", target: "/app/templates", intent: "open_templates" },
    { label: "Create an Agreement", target: "/app/agreements/new/wizard?step=1", intent: "create_agreement" },
    { label: "Find unsigned agreements", target: "/app/agreements", intent: "find_unsigned_agreements" },
    { label: "Show funding issues", target: "/app/agreements", intent: "show_funding_issues" },
  ];

  if (workspaceMode === "disputes") {
    return {
      can_navigate: true,
      capabilities: [
        "Review dispute evidence",
        "Summarize dispute history",
        "Explain agreement requirements",
        "Suggest next steps",
        "Escalation guidance",
      ],
      actions: [
        { label: "Open Resolution Cases", target: "/app/disputes", intent: "open_disputes" },
        ...commonActions,
      ],
    };
  }

  if (workspaceMode === "leads") {
    return {
      can_navigate: true,
      capabilities: ["Review opportunity details", "Find missing customer information", "Prepare follow-up", "Open estimate handoff"],
      actions: [
        { label: "Open Opportunities", target: "/app/opportunities", intent: "open_opportunities" },
        { label: "Open Estimates", target: "/app/estimates", intent: "open_estimates" },
        { label: "Create an Agreement", target: "/app/agreements/new/wizard?step=1", intent: "create_agreement" },
      ],
    };
  }

  if (workspaceMode === "estimates") {
    return {
      can_navigate: true,
      capabilities: ["Review estimate readiness", "Find missing scope or pricing", "Prepare agreement handoff"],
      actions: [
        { label: "Open Estimates", target: "/app/estimates", intent: "open_estimates" },
        { label: "Open Opportunities", target: "/app/opportunities", intent: "open_opportunities" },
        { label: "Create an Agreement", target: "/app/agreements/new/wizard?step=1", intent: "create_agreement" },
      ],
    };
  }

  if (workspaceMode === "team") {
    return {
      can_navigate: true,
      capabilities: ["Review assignment gaps", "Check workload", "Find schedule risks"],
      actions: [
        { label: "Open Assignments", target: "/app/team/assignments", intent: "open_assignments" },
        { label: "Open Schedule", target: "/app/team/schedule", intent: "open_schedule" },
        { label: "Open Team Members", target: "/app/team/members", intent: "open_team_members" },
      ],
    };
  }

  if (workspaceMode === "marketing") {
    return {
      can_navigate: true,
      capabilities: ["Review website readiness", "Find profile gaps", "Prepare portfolio, review, and lead-generation suggestions"],
      actions: [
        { label: "Open Marketing", target: "/app/marketing", intent: "open_marketing" },
        { label: "Review Website", target: "/app/marketing?tab=website", intent: "review_website" },
        { label: "Review Leads", target: "/app/opportunities", intent: "review_leads" },
      ],
    };
  }

  if (workspaceMode === "insights") {
    return {
      can_navigate: true,
      capabilities: ["Explain business health", "Find source records", "Recommend investigations"],
      actions: [
        { label: "Open Insights", target: "/app/insights", intent: "open_insights" },
        { label: "Open Agreements", target: "/app/agreements", intent: "open_agreements" },
        { label: "Open Payments", target: "/app/payments", intent: "open_payments" },
      ],
    };
  }

  return {
    can_navigate: true,
    capabilities: ["Open this workspace", "Find relevant records", "Suggest safe next steps"],
    actions: [
      { label: "Open Dashboard", target: "/app/dashboard", intent: "open_dashboard" },
      ...commonActions.slice(0, 2),
    ],
  };
}

const UNRELATED_ENTITY_CONTEXT_KEYS = [
  "agreement_id", "agreement_summary", "lead_id", "lead_summary", "template_id", "template_summary",
  "milestone_id", "milestone_summary", "proposal_id", "proposal_summary", "dispute_id", "dispute_summary",
  "subcontractor_invitation_id", "invitation_id",
];

function sanitizeContextForWorkspace(context = {}, workspaceMode = "general") {
  const clean = context && typeof context === "object" ? { ...context } : {};
  if (workspaceMode === "marketing") {
    UNRELATED_ENTITY_CONTEXT_KEYS.forEach((key) => delete clean[key]);
    clean.workspace = "marketing";
    clean.workspace_mode = "marketing";
    clean.page = "marketing";
  }
  return clean;
}

export function useAssistantDock() {
  return useContext(AssistantDockContext);
}

export function GlobalCopilotTrigger() {
  const { openAssistant, isOpen } = useAssistantDock();

  return (
    <button
      type="button"
      data-testid="assistant-dock-open-button"
      aria-label={isOpen ? "Project Assistant open" : "Open Project Assistant"}
      aria-pressed={isOpen}
      onClick={() => openAssistant()}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        isOpen
          ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
          : "border-slate-200 bg-white text-slate-800 hover:border-amber-200 hover:text-[#18395f] hover:shadow-md"
      }`}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Project Assistant</span>
    </button>
  );
}

// ── Proactive briefing panel ──────────────────────────────────────────────────

function getBriefingCta(item) {
  const key = String(item?.key || "");
  if (key === "agreements-awaiting-signature") return "Prepare reminder";
  if (key.startsWith("agreement-draft:")) return "Open draft";
  if (key === "invoices-pending-approval") return "Review invoice";
  if (key.startsWith("invoice-approved:")) return "Review payment release";
  if (key === "invoices-disputed") return "Review dispute";
  if (key === "milestone-submitted-review") return "Review work";
  if (key === "agreements-awaiting-funding") return "Open agreements";
  return saferAssistantActionLabel(item?.buttonLabel || "Open");
}

function BriefingPanel({ items, onNavigate }) {
  if (!Array.isArray(items) || !items.length) return null;

  return (
    <div
      data-testid="copilot-briefing-panel"
      className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="text-sm font-semibold text-slate-800">
          Here's what needs your attention:
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.key} className="px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">{item.title}</div>
            <div className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</div>
            <button
              type="button"
              onClick={() => onNavigate(item.navigationTarget || "/app/dashboard")}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition"
            >
              {getBriefingCta(item)}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        Ask me anything about these items in the chat below.
      </div>
    </div>
  );
}

// ── Job health panel ─────────────────────────────────────────────────────────

function buildDraftForFlag(flag) {
  const { type } = flag;
  if (type === "signature_pending") {
    return draftSignatureFollowUp({
      agreementTitle: flag.agreementTitle,
      daysSinceSent: flag.daysSince,
    });
  }
  if (type === "relationship_risk" || type === "no_activity") {
    return draftCheckIn({
      agreementTitle: flag.agreementTitle,
      daysSinceActivity: flag.daysSince,
    });
  }
  if (type === "milestone_overdue" || type === "payment_delayed" || type === "funding_not_released") {
    return draftMilestoneUpdate({
      milestoneTitle: flag.milestoneTitle || "",
      agreementTitle: flag.agreementTitle,
    });
  }
  return null;
}

const SEVERITY_STYLES = {
  urgent: { dot: "bg-rose-500", badge: "bg-rose-50 border-rose-200 text-rose-800" },
  warning: { dot: "bg-amber-400", badge: "bg-amber-50 border-amber-200 text-amber-800" },
  info: { dot: "bg-blue-400", badge: "bg-blue-50 border-blue-200 text-blue-800" },
};

function HealthFlagRow({ flag, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const draft = buildDraftForFlag(flag);
  const styles = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.info;

  function handleCopy() {
    if (!draft) return;
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={`rounded-xl border p-3 ${styles.badge}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-5">{flag.message}</p>
          {flag.draftedAction && (
            <p className="mt-0.5 text-[11px] opacity-75">{flag.draftedAction}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { onNavigate(flag.ctaRoute); }}
              className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/60 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/90 transition"
            >
              {flag.ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </button>
            {draft && (
              <button
                type="button"
                onClick={() => setExpanded((p) => !p)}
                className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/60 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/90 transition"
              >
                {expanded ? "Hide message" : "View drafted message"}
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>

          {expanded && draft && (
            <div className="mt-3 rounded-lg border border-current/20 bg-white/70 p-3">
              <div className="mb-1 text-[11px] font-bold opacity-70">Subject: {draft.subject}</div>
              <pre className="whitespace-pre-wrap text-[11px] leading-5 text-slate-800">{draft.body}</pre>
              <button
                type="button"
                onClick={handleCopy}
                className="mt-2 inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ClipboardCopy className="h-3 w-3" />
                {copied ? "Copied!" : "Copy message"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobHealthPanel({ flags, onNavigate }) {
  if (!Array.isArray(flags) || !flags.length) return null;

  const urgentCount = flags.filter((f) => f.severity === "urgent").length;

  return (
    <div
      data-testid="copilot-job-health-panel"
      className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <AlertTriangle className={`h-4 w-4 ${urgentCount > 0 ? "text-rose-500" : "text-amber-500"}`} />
        <div className="text-sm font-semibold text-slate-800">
          {urgentCount > 0 ? `${urgentCount} urgent item${urgentCount !== 1 ? "s" : ""} need attention` : "Active job health check"}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {flags.map((flag, idx) => (
          <div key={`${flag.type}:${flag.agreementId}:${idx}`} className="px-3 py-3">
            <HealthFlagRow flag={flag} onNavigate={onNavigate} />
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        Ask me about any of these jobs in the chat below.
      </div>
    </div>
  );
}

// ── Desktop dock shell ────────────────────────────────────────────────────────

function DesktopAssistantDock({
  open,
  minimized,
  title,
  context,
  healthFlags,
  onAction,
  onClose,
  onMinimize,
}) {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const hasBriefing = Array.isArray(context?.briefingItems) && context.briefingItems.length > 0;
  const hasHealthFlags = Array.isArray(healthFlags) && healthFlags.length > 0;

  // Scroll to top whenever the dock opens, so panels are always visible first.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [open]);

  return (
    <div
      className={`pointer-events-none fixed inset-y-0 right-0 z-40 hidden xl:flex ${
        open ? "translate-x-0 opacity-100" : "translate-x-full invisible opacity-0"
      } transition-transform duration-200`}
      aria-hidden={!open}
    >
      <div
        data-testid="assistant-desktop-dock"
        className={`pointer-events-auto flex h-full border-l border-slate-200 bg-white/95 shadow-2xl backdrop-blur ${
          minimized ? "w-20" : "w-[430px]"
        }`}
      >
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Project Assistant
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="assistant-desktop-dock-minimize"
                onClick={onMinimize}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
              >
                {minimized ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                data-testid="assistant-desktop-dock-close"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          {minimized ? (
            <div className="flex flex-1 items-center justify-center">
              <Wand2 className="h-6 w-6 text-slate-500" />
            </div>
          ) : (
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-4">
              <BriefingPanel
                items={context?.briefingItems}
                onNavigate={(route) => { navigate(route); onClose(); }}
              />
              <JobHealthPanel
                flags={healthFlags}
                onNavigate={(route) => { navigate(route); onClose(); }}
              />
              <StartWithAIAssistant
                key={`${context?.workspace_mode || context?.page || "general"}:${
                  context?.current_route || ""
                }`}
                mode="dock"
                context={context}
                onAction={onAction}
                onClose={onClose}
                hideContextHeader={hasBriefing || hasHealthFlags}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileAssistantSheet({ open, onClose, context, onAction }) {
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const isMarketing = String(context?.workspace_mode || context?.workspace || context?.page || "") === "marketing";
  useEffect(() => { setShowQuickCapture(false); }, [context?.context_revision, isMarketing]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white xl:hidden" data-testid="assistant-mobile-sheet">
      {isMarketing && !showQuickCapture ? <>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><div className="text-xs font-black uppercase tracking-wider text-slate-500">Project Assistant</div><div className="text-sm font-black text-slate-900">Marketing · {context?.active_step_label || "Overview"}</div></div><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">Close</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4"><StartWithAIAssistant key={`mobile:${context?.context_revision || context?.current_route || "marketing"}`} mode="panel" context={context} onAction={onAction} onClose={onClose} /><button type="button" onClick={() => setShowQuickCapture(true)} className="mt-4 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">Open Quick Capture</button></div>
      </> : <ProjectAssistantQuickCapture compact onClose={isMarketing ? () => setShowQuickCapture(false) : onClose} />}
    </div>
  );
}

export function AssistantDockProvider({ children }) {
  const location = useLocation();
  const routeContext = useMemo(() => buildRouteContext(location), [location]);
  const routeWorkspaceMode = routeContext.workspace_mode;
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dockTitle, setDockTitle] = useState("Project Assistant");
  const [dockContext, setDockContext] = useState(routeContext);
  const [dockOnAction, setDockOnAction] = useState(null);
  const [pageAssistantOnAction, setPageAssistantOnAction] = useState(null);
  const [pageAssistantContext, setPageAssistantContext] = useState(routeContext);
  const [healthFlags, setHealthFlags] = useState([]);

  // Fetch job health data when the dock opens in agreements workspace mode
  useEffect(() => {
    if (!open || routeWorkspaceMode !== "agreements") {
      setHealthFlags([]);
      return;
    }

    let cancelled = false;

    async function fetchAndCheck() {
      try {
        const [agreementsRes, milestonesRes] = await Promise.allSettled([
          api.get("/projects/agreements/", { params: { page_size: 50, status: "active" } }),
          api.get("/projects/milestones/", { params: { page_size: 100 } }),
        ]);
        if (cancelled) return;
        const agreements = agreementsRes.status === "fulfilled"
          ? (agreementsRes.value?.data?.results ?? agreementsRes.value?.data ?? [])
          : [];
        const milestones = milestonesRes.status === "fulfilled"
          ? (milestonesRes.value?.data?.results ?? milestonesRes.value?.data ?? [])
          : [];
        const flags = checkJobHealth({ agreements, milestones });
        if (!cancelled) setHealthFlags(flags);
      } catch {
        if (!cancelled) setHealthFlags([]);
      }
    }

    fetchAndCheck();
    return () => { cancelled = true; };
  }, [open, routeWorkspaceMode]);

  useEffect(() => {
    setPageAssistantContext(routeContext);
    setPageAssistantOnAction(null);
    setDockOnAction(null);
    setDockTitle(copilotLabelForRoute(routeContext.current_route));
    setDockContext(routeContext);
  }, [routeContext, routeWorkspaceMode]);

  const openAssistant = useCallback(
    (options = {}) => {
      setOpen(true);
      setMinimized(false);
      const optionContext = sanitizeContextForWorkspace(options.context || routeContext, routeContext.workspace_mode);
      const pageContextWorkspace = String(
        pageAssistantContext.workspace_mode || pageAssistantContext.page || ""
      );
      const scopedPageAssistantContext =
        pageContextWorkspace === routeContext.workspace_mode ? pageAssistantContext : {};
      const nextContext = sanitizeContextForWorkspace({
        ...routeContext,
        ...scopedPageAssistantContext,
        ...optionContext,
        workspace_mode:
          optionContext.workspace_mode ||
          optionContext.page ||
          scopedPageAssistantContext.workspace_mode ||
          routeContext.workspace_mode,
        page:
          optionContext.page ||
          optionContext.workspace_mode ||
          scopedPageAssistantContext.page ||
          routeContext.page,
      }, routeContext.workspace_mode);
      setDockTitle(options.title || copilotLabelForRoute(nextContext.current_route));
      setDockContext(nextContext);
      setDockOnAction(() =>
        typeof options.onAction === "function" ? options.onAction : null
      );
    },
    [pageAssistantContext, routeContext]
  );

  const updateAssistantOnAction = useCallback((fn) => {
    setPageAssistantOnAction(() => (typeof fn === "function" ? fn : null));
  }, []);

  const updateAssistantContext = useCallback((context = {}) => {
    const cleanContext = sanitizeContextForWorkspace(context, routeContext.workspace_mode);
    const workspacePage =
      cleanContext.workspace_mode ||
      cleanContext.page ||
      routeContext.workspace_mode;
    if (workspacePage !== routeContext.workspace_mode) {
      return;
    }
    const mergedAiContext = buildAiContext({
      ...(routeContext.aiContext || {}),
      ...(cleanContext.aiContext || {}),
      page: workspacePage,
    });
    const nextContext = sanitizeContextForWorkspace({
      ...routeContext,
      ...cleanContext,
      workspace_mode: workspacePage,
      page:
        cleanContext.page ||
        cleanContext.workspace_mode ||
        routeContext.page,
      aiContext: mergedAiContext,
    }, workspacePage);
    if (workspacePage === "marketing" && nextContext.active_step_label) {
      setDockTitle(`Project Assistant for ${nextContext.active_step_label}`);
    }
    setPageAssistantContext(nextContext);
    setDockContext((prev) => {
      if (!open || !prev) return prev;
      return {
        ...routeContext,
        ...prev,
        ...nextContext,
      };
    });
  }, [open, routeContext]);

  const closeAssistant = useCallback(() => {
    setOpen(false);
    setMinimized(false);
  }, []);

  const minimizeAssistant = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  const toggleAssistant = useCallback(() => {
    if (open) {
      closeAssistant();
      return;
    }
    openAssistant();
  }, [closeAssistant, open, openAssistant]);

  const value = useMemo(
    () => ({
      openAssistant,
      closeAssistant,
      minimizeAssistant,
      toggleAssistant,
      updateAssistantContext,
      updateAssistantOnAction,
      isOpen: open,
      isMinimized: minimized,
    }),
    [closeAssistant, minimized, open, openAssistant, toggleAssistant, updateAssistantContext, updateAssistantOnAction]
  );

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
      <DesktopAssistantDock
        open={open}
        minimized={minimized}
        title={dockTitle}
        context={dockContext || buildRouteContext(location)}
        healthFlags={healthFlags}
        onAction={dockOnAction ?? pageAssistantOnAction}
        onClose={closeAssistant}
        onMinimize={minimizeAssistant}
      />
      <MobileAssistantSheet open={open} onClose={closeAssistant} context={dockContext || routeContext} onAction={dockOnAction ?? pageAssistantOnAction} />
    </AssistantDockContext.Provider>
  );
}
