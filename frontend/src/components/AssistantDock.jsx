import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { PanelRightClose, PanelRightOpen, Sparkles, Wand2 } from "lucide-react";

import StartWithAIAssistant from "./StartWithAIAssistant.jsx";

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
  if (path.includes("/templates")) return "templates";
  if (path.includes("/agreements") && path.includes("/wizard")) return "agreement_wizard";
  if (path.includes("/agreements")) return "agreements";
  if (path.includes("/milestones")) return "milestones";
  if (path.includes("/invoices") || path.includes("/payments") || path.includes("/business")) {
    return "invoices";
  }
  if (path.includes("/dashboard")) return "dashboard";
  if (path.includes("/bids") || path.includes("/public-presence")) return "leads";
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
        "Copilot is checking the draft agreement, milestone structure, funding state, signatures, amendments, invoices, and payment workflow steps.",
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
        "Copilot is checking reusable workflow structure, not agreement signature or funding readiness.",
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
        "Copilot is checking agreement readiness, milestone structure, funding, signatures, amendments, invoices, and payment workflow steps.",
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
        "Copilot is checking schedule, completion evidence, approvals, and invoice handoff.",
    };
  }

  if (workspaceMode === "invoices") {
    return {
      headline: "Review payments",
      helperText:
        "Get help with invoice readiness, funding state, approvals, payouts, and dispute-safe payment steps.",
      statusText: "Payment workspace context loaded",
      promptPlaceholder:
        'Examples: "Review this invoice" or "Help me understand payment status."',
      nextActionText: "Next: Review payment status, approvals, funding, and payout workflow.",
      nextGuidanceTitle: "Payment guidance",
      nextGuidance:
        "Copilot is checking invoice approval, funding, escrow or direct-pay state, payout readiness, and dispute context.",
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
      nextGuidance: "Copilot is checking cross-workspace priorities and next actions.",
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
        "Copilot is prepared to help review dispute evidence, summarize history, explain agreement requirements, suggest next steps, and outline escalation guidance.",
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
        "Copilot is checking administrative context, routing, contractor records, marketplace health, and support follow-up.",
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
  return {
    current_route: currentRoute,
    page: workspaceMode,
    workspace_mode: workspaceMode,
    ai_panel: defaultAssistantPanelForWorkspace(workspaceMode),
    navigation_assist: buildNavigationAssistContext(workspaceMode),
  };
}

function copilotLabelForRoute(route = "") {
  const workspaceMode = workspaceModeForRoute(route);
  if (workspaceMode === "agreement_wizard") return "AI Copilot for Agreement Creation";
  if (workspaceMode === "agreements") return "AI Copilot for Agreements";
  if (workspaceMode === "milestones") return "AI Copilot for Milestones";
  if (workspaceMode === "invoices") return "AI Copilot for Payments";
  if (workspaceMode === "templates") return "AI Copilot for Templates";
  if (workspaceMode === "disputes") return "AI Copilot for Dispute Resolution";
  if (workspaceMode === "admin") return "AI Copilot for Admin";
  if (workspaceMode === "leads") return "AI Copilot for Leads";
  if (workspaceMode === "dashboard") return "AI Copilot for Dashboard";
  return "AI Copilot";
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
        { label: "Open Disputes", target: "/app/disputes", intent: "open_disputes" },
        ...commonActions,
      ],
    };
  }

  return {
    can_navigate: true,
    capabilities: ["Open workspaces", "Find records", "Route to next tasks"],
    actions: commonActions,
  };
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
      aria-label={isOpen ? "AI Copilot open" : "Open AI Copilot"}
      aria-pressed={isOpen}
      onClick={() => openAssistant()}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        isOpen
          ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
          : "border-slate-200 bg-white text-slate-800 hover:border-amber-200 hover:text-[#18395f] hover:shadow-md"
      }`}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">AI Copilot</span>
    </button>
  );
}

function DesktopAssistantDock({
  open,
  minimized,
  title,
  context,
  onAction,
  onClose,
  onMinimize,
}) {
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
                AI Copilot
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
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <StartWithAIAssistant
                key={`${context?.workspace_mode || context?.page || "general"}:${
                  context?.current_route || ""
                }`}
                mode="dock"
                context={context}
                onAction={onAction}
                onClose={onClose}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AssistantDockProvider({ children }) {
  const location = useLocation();
  const routeContext = useMemo(() => buildRouteContext(location), [location]);
  const routeWorkspaceMode = routeContext.workspace_mode;
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dockTitle, setDockTitle] = useState("AI Copilot");
  const [dockContext, setDockContext] = useState(routeContext);
  const [dockOnAction, setDockOnAction] = useState(null);
  const [pageAssistantOnAction, setPageAssistantOnAction] = useState(null);
  const [pageAssistantContext, setPageAssistantContext] = useState(routeContext);

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
      const optionContext = options.context || routeContext;
      const pageContextWorkspace = String(
        pageAssistantContext.workspace_mode || pageAssistantContext.page || ""
      );
      const scopedPageAssistantContext =
        pageContextWorkspace === routeContext.workspace_mode ? pageAssistantContext : {};
      const nextContext = {
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
      };
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
    const cleanContext = context && typeof context === "object" ? context : {};
    const nextContext = {
      ...routeContext,
      ...cleanContext,
      workspace_mode:
        cleanContext.workspace_mode ||
        cleanContext.page ||
        routeContext.workspace_mode,
      page:
        cleanContext.page ||
        cleanContext.workspace_mode ||
        routeContext.page,
    };
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
        onAction={dockOnAction ?? pageAssistantOnAction}
        onClose={closeAssistant}
        onMinimize={minimizeAssistant}
      />
    </AssistantDockContext.Provider>
  );
}
