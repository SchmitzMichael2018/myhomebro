// src/components/Sidebar.jsx
// v2026-03-15 — add Templates nav item
// - Default export remains DESKTOP sidebar (hidden on mobile) to avoid desktop breakage
// - Add `variant="plain"` to render sidebar CONTENT only (for mobile overlay shell)

import React, { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import api, { getAgreementClosureStatus, closeAndArchiveAgreement } from "../api";
import toast from "react-hot-toast";
import { useWhoAmI } from "../hooks/useWhoAmI.js";
import RefundEscrowModal from "./RefundEscrowModal";
import StripeOnboardingStatus from "./StripeOnboardingStatus";
import { useAssistantDock } from "./AssistantDock.jsx";
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileSignature,
  Globe,
  Gauge,
  HandCoins,
  LayoutDashboard,
  Link as LinkIcon,
  MessageSquareWarning,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Users,
  UserRound,
  Wrench,
} from "lucide-react";

const NAV_HINTS = {
  "/app/dashboard": "See what needs attention and what to do next",
  "/app/assistant": "Start new work with AI guidance across agreements, templates, leads, and setup",
  "/app/business": "View revenue, activity, and business performance",
  "/app/reviewer/queue": "Review items waiting on your action or approval",
  "/app/agreements": "Create and manage project agreements, signatures, and funding",
  "/app/templates": "Build reusable project templates and milestone structures",
  "/app/milestones": "Track active work and what's ready to invoice",
  "/app/subcontractors": "Manage your team, subcontractors, and assignments",
  "/app/public-presence": "Showcase your work and build trust with customers",
  "/app/assignments": "Track work assigned to you and your team",
  "/app/team-schedule": "View upcoming work, deadlines, and project timelines",
  "/app/team": "Manage your team, subcontractors, and assignments",
  "/app/invoices": "Send payment requests and track approvals, disputes, and payouts",
  "/app/customers": "View and manage your clients and project history",
  "/app/calendar": "View upcoming work, deadlines, and project timelines",
  "/app/expenses": "Track project expenses and job costs",
  "/app/disputes": "Manage issues, disagreements, and resolutions",
  "/app/profile": "Manage your account, preferences, and payment setup",
  "/app/onboarding": "Manage your account, preferences, and payment setup",
  "/app/intake/new": "Capture new leads and start projects quickly",
};

const SidebarNavCtx = createContext({
  navHint: null,
  showNavHint: () => {},
  hideNavHint: () => {},
});

function NavGroup({ label, children, className = "" }) {
  return (
    <div className={`space-y-2.5 ${className}`.trim()}>
      <div className="px-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500/95">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Item({ to, label, icon: Icon, emoji, title, hint }) {
  const location = useLocation();
  const { navHint, showNavHint, hideNavHint } = useContext(SidebarNavCtx);
  const tooltipId = React.useId();
  const resolvedHint = hint || NAV_HINTS[to];
  const isCurrent = location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <div className="relative">
      <NavLink
        to={to}
        data-close-sidebar="1"
        aria-describedby={navHint?.id === tooltipId ? tooltipId : undefined}
        className={({ isActive }) =>
          [
            "group flex min-w-0 overflow-hidden items-center gap-3 rounded-xl px-3.5 py-3 text-[15px] font-semibold transition duration-200",
            "border",
            isActive
              ? "bg-slate-900 text-white border-slate-950/20 shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
              : "bg-[#f7f8fa] text-slate-700 border-slate-200/95 shadow-[0_2px_6px_rgba(15,23,42,0.04)] hover:bg-white hover:text-[#18395f] hover:border-amber-200 hover:shadow-[0_10px_22px_rgba(15,23,42,0.08),0_0_0_1px_rgba(245,158,11,0.08)]",
          ].join(" ")
        }
        onMouseEnter={(event) => showNavHint(event, resolvedHint, tooltipId)}
        onFocus={(event) => showNavHint(event, resolvedHint, tooltipId, 0)}
        onMouseLeave={() => hideNavHint()}
        onBlur={() => hideNavHint(0)}
        onClick={() => hideNavHint(0)}
        title={title || undefined}
      >
        <span aria-hidden="true">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
              isCurrent
                ? "border-white/15 bg-white/10 text-white"
                : "border-slate-200 bg-white text-slate-500 group-hover:border-amber-100 group-hover:bg-amber-50/70 group-hover:text-[#214d7f]"
            }`}
          >
            {Icon ? <Icon size={16} strokeWidth={2} /> : <span className="text-base leading-none">{emoji}</span>}
          </span>
        </span>
        <span className="min-w-0 truncate leading-5">{label}</span>
      </NavLink>
    </div>
  );
}

function SubItem({ to, label }) {
  return (
    <NavLink
      to={to}
      data-close-sidebar="1"
      className={({ isActive }) =>
        [
          "ml-6 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
          "border",
          isActive
            ? "bg-slate-900 text-white border-black/10 shadow-sm"
            : "bg-white/40 text-slate-700 border-black/10 hover:bg-white hover:text-slate-900",
        ].join(" ")
      }
    >
      <span className="text-[10px] opacity-70">â€¢</span>
      <span>{label}</span>
    </NavLink>
  );
}

/**
 * Sidebar
 *
 * Props:
 *   variant:
 *     - "desktop" (default): renders the existing desktop sidebar wrapper (hidden on mobile)
 *     - "plain": renders ONLY the inner sidebar content (no desktop-only <aside>)
 *
 * Why:
 *   Desktop stays exactly the same. Mobile overlay can reuse the same content via variant="plain".
 */
export default function Sidebar({ variant = "desktop" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, isContractor, isEmployee, isSubcontractor } = useWhoAmI();
  const { openAssistant } = useAssistantDock();

  const [refundOpen, setRefundOpen] = useState(false);

  // Global close-out modal state
  const [showCloseoutModal, setShowCloseoutModal] = useState(false);
  const [closeoutAgreementId, setCloseoutAgreementId] = useState(null);
  const [closeoutStatus, setCloseoutStatus] = useState(null);
  const [closingOut, setClosingOut] = useState(false);
  const [stripeRequirement, setStripeRequirement] = useState(null);
  const [navHint, setNavHint] = useState(null);
  const showTooltipTimeoutRef = useRef(null);
  const hideTooltipTimeoutRef = useRef(null);

  const APP_BASE = "/app";
  const EMP_BASE = "/app/employee";

  const isAdmin = useMemo(() => {
    const role = data?.type || data?.role || "";
    return String(role).toLowerCase() === "admin";
  }, [data]);

  const isOnAdminRoute = location.pathname.startsWith("/app/admin");

  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem("access");
      localStorage.removeItem("refresh");
    } catch {}
    try {
      if (api?.defaults?.headers?.common) {
        delete api.defaults.headers.common.Authorization;
      }
    } catch {}
    navigate("/", { replace: true });
  }, [navigate]);

  const isContractorOwner = useMemo(() => {
    const role = data?.role || data?.type || "";
    return isContractor && String(role).toLowerCase() === "contractor_owner";
  }, [data, isContractor]);

  const canAccessReviewerQueue = useMemo(() => {
    if (isContractorOwner) return true;
    if (!isEmployee) return false;
    const teamRole = String(data?.team_role || data?.role || "").toLowerCase();
    return teamRole === "employee_milestones" || teamRole === "employee_supervisor";
  }, [data, isContractorOwner, isEmployee]);

  const activeAgreementId = useMemo(() => {
    const p = location.pathname || "";
    const m = p.match(/^\/app\/agreements\/(\d+)(\/|$)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

  const activeAgreementLabel = useMemo(() => {
    try {
      return localStorage.getItem("activeAgreementTitle") || "";
    } catch {
      return "";
    }
  }, [location.pathname]);

  const showRefundContext = Boolean(isContractorOwner && activeAgreementId);

  const consoleLabel = useMemo(() => {
    if (isAdmin) return "Admin Console";
    if (isEmployee) return "Team Member Console";
    if (isSubcontractor) return "Subcontractor Console";
    return "Contractor Console";
  }, [isAdmin, isEmployee, isSubcontractor]);

  const clearTooltipTimers = useCallback(() => {
    if (showTooltipTimeoutRef.current) {
      window.clearTimeout(showTooltipTimeoutRef.current);
      showTooltipTimeoutRef.current = null;
    }
    if (hideTooltipTimeoutRef.current) {
      window.clearTimeout(hideTooltipTimeoutRef.current);
      hideTooltipTimeoutRef.current = null;
    }
  }, []);

  const hideNavHint = useCallback((delay = 70) => {
    clearTooltipTimers();
    hideTooltipTimeoutRef.current = window.setTimeout(() => {
      setNavHint(null);
      hideTooltipTimeoutRef.current = null;
    }, delay);
  }, [clearTooltipTimers]);

  const showNavHint = useCallback((event, hintText, tooltipId, delay = 120) => {
    if (!hintText || typeof window === "undefined") return;

    clearTooltipTimers();

    const rect = event.currentTarget.getBoundingClientRect();
    const estimatedWidth = 288; // ~w-72
    const estimatedHeight = 72;
    const gutter = 12;
    const fallbackLeft = 16;
    const maxLeft = Math.max(fallbackLeft, window.innerWidth - estimatedWidth - 16);
    const left = Math.min(rect.right + gutter, maxLeft);
    const minTop = 16 + estimatedHeight / 2;
    const maxTop = Math.max(minTop, window.innerHeight - 16 - estimatedHeight / 2);
    const top = Math.min(Math.max(rect.top + rect.height / 2, minTop), maxTop);

    showTooltipTimeoutRef.current = window.setTimeout(() => {
      setNavHint({
        id: tooltipId,
        text: hintText,
        top,
        left,
      });
      showTooltipTimeoutRef.current = null;
    }, delay);
  }, [clearTooltipTimers]);

  useEffect(() => {
    setNavHint(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!navHint) return undefined;

    const handleViewportChange = () => setNavHint(null);

    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [navHint]);

  useEffect(() => () => clearTooltipTimers(), [clearTooltipTimers]);

  const mainNav = useMemo(() => {
    if (isAdmin) {
      return (
        <>
          <Item to={`${APP_BASE}/admin`} label="Admin" icon={ShieldCheck} />
          {isOnAdminRoute && (
            <div className="mt-2 space-y-1">
              <SubItem to="/app/admin" label="Overview" />
              <SubItem to="/app/admin?view=goals" label="Goals (CEO)" />
              <SubItem to="/app/admin?view=contractors" label="Contractors" />
              <SubItem to="/app/admin?view=homeowners" label="Customers" />
              <SubItem to="/app/admin?view=agreements" label="Agreements" />
              <SubItem to="/app/admin/disputes" label="Disputes" />
              <SubItem to="/app/admin?view=geo" label="Geo / Map" />
              <SubItem to="/app/admin?view=fee_audit" label="Fee Audit" />
              <SubItem to="/app/admin?view=support" label="Support Tools" />
            </div>
          )}
        </>
      );
    }

    if (isEmployee) {
      return (
        <>
          <Item to={`${EMP_BASE}/dashboard`} label="Dashboard" icon={LayoutDashboard} />
          {canAccessReviewerQueue ? (
            <Item to={`${APP_BASE}/reviewer/queue`} label="Awaiting Review" icon={SearchCheck} />
          ) : null}
          <Item to={`${EMP_BASE}/agreements`} label="My Agreements" icon={FileSignature} />
          <Item to={`${EMP_BASE}/milestones`} label="Milestones" icon={SquareKanban} />
          <Item to={`${EMP_BASE}/calendar`} label="Calendar" icon={CalendarDays} />
        </>
      );
    }

    if (isSubcontractor) {
      return (
        <>
          <Item to={`${APP_BASE}/subcontractor/assigned-work`} label="My Assigned Work" icon={Wrench} />
        </>
      );
    }

    return (
      <>
        <Item to={`${APP_BASE}/dashboard`} label="Dashboard" icon={LayoutDashboard} />
        <Item to={`${APP_BASE}/assistant`} label="AI Workspace" icon={Bot} />
        <Item to={`${APP_BASE}/business`} label="Business Dashboard" icon={Gauge} />
        <Item to={`${APP_BASE}/reviewer/queue`} label="Awaiting Review" icon={SearchCheck} />
        <Item to={`${APP_BASE}/agreements`} label="Agreements" icon={FileSignature} />
        <Item to={`${APP_BASE}/templates`} label="Templates" icon={ClipboardList} />
        <Item to={`${APP_BASE}/milestones`} label="Milestones" icon={SquareKanban} />
        <Item to={`${APP_BASE}/subcontractors`} label="Subcontractors" icon={Wrench} />
        <Item to={`${APP_BASE}/public-presence`} label="Public Presence" icon={Globe} />
        <Item to={`${APP_BASE}/assignments`} label="Assignments" icon={BriefcaseBusiness} />
        <Item to={`${APP_BASE}/team-schedule`} label="Team Schedule" icon={CalendarDays} />
        <Item to={`${APP_BASE}/team`} label="Team" icon={Users} />
        <Item to={`${APP_BASE}/invoices`} label="Invoices" icon={CreditCard} />
        <Item to={`${APP_BASE}/customers`} label="Customers" icon={Users} />
        <Item to={`${APP_BASE}/calendar`} label="Calendar" icon={CalendarDays} />
        <Item to={`${APP_BASE}/expenses`} label="Expenses" icon={HandCoins} />
        <Item to={`${APP_BASE}/disputes`} label="Disputes" icon={MessageSquareWarning} />
      </>
    );
  }, [canAccessReviewerQueue, isEmployee, isAdmin, isOnAdminRoute, isSubcontractor]);

  const accountNav = useMemo(() => {
    if (isAdmin) {
      return <Item to={`${APP_BASE}/admin`} label="Admin Home" icon={ShieldCheck} />;
    }

    if (isEmployee) {
      return <Item to={`${EMP_BASE}/profile`} label="My Profile" icon={UserRound} />;
    }

    if (isSubcontractor) {
      return null;
    }

    return (
      <>
        <Item to={`${APP_BASE}/profile`} label="My Profile" icon={UserRound} />
        <Item
          to={`${APP_BASE}/onboarding`}
          icon={LinkIcon}
          label={
            <>
              <span>Stripe Onboarding</span>
              <StripeOnboardingStatus className="ml-2" />
            </>
          }
        />
      </>
    );
  }, [isEmployee, isAdmin, isSubcontractor]);

  // Close-out listener
  useEffect(() => {
    if (!isContractorOwner) return;

    const onInvoicePaid = async (evt) => {
      const agreementId = Number(evt?.detail?.agreementId || 0);
      if (!agreementId) return;

      try {
        const status = await getAgreementClosureStatus(agreementId);
        if (status?.eligible && !status?.already_archived) {
          setCloseoutAgreementId(agreementId);
          setCloseoutStatus(status);
          setShowCloseoutModal(true);
        }
      } catch {}
    };

    window.addEventListener("mhb:invoice_paid", onInvoicePaid);
    return () => window.removeEventListener("mhb:invoice_paid", onInvoicePaid);
  }, [isContractorOwner]);

  useEffect(() => {
    if (isAdmin || isEmployee || isSubcontractor) return undefined;

    const onStripeRequirement = (event) => {
      setStripeRequirement(event?.detail || null);
    };

    window.addEventListener("mhb:stripe_requirement", onStripeRequirement);
    return () => window.removeEventListener("mhb:stripe_requirement", onStripeRequirement);
  }, [isAdmin, isEmployee, isSubcontractor]);

  const confirmCloseout = async () => {
    if (!closeoutAgreementId) return;
    setClosingOut(true);
    try {
      await closeAndArchiveAgreement(closeoutAgreementId);
      toast.success(`Agreement #${closeoutAgreementId} closed & archived.`);
      setShowCloseoutModal(false);
      setCloseoutAgreementId(null);
      setCloseoutStatus(null);
      navigate("/app/agreements");
    } catch {
      toast.error("Unable to close & archive agreement.");
    } finally {
      setClosingOut(false);
    }
  };

  // --- Inner content (reused by both desktop and mobile overlay) ---
  const inner = (
    <SidebarNavCtx.Provider value={{ navHint, showNavHint, hideNavHint }}>
      <>
      {navHint && typeof document !== "undefined"
        ? createPortal(
            <div
              id={navHint.id}
              role="tooltip"
              className="pointer-events-none fixed z-[1400] w-72 max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-[0_18px_44px_rgba(15,23,42,0.22)] ring-1 ring-black/5"
              style={{
                top: `${navHint.top}px`,
                left: `${navHint.left}px`,
                transform: "translateY(-50%)",
              }}
            >
              {navHint.text}
            </div>,
            document.body
          )
        : null}

      {showCloseoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-extrabold text-gray-900">
              Agreement Complete
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              Agreement #{closeoutAgreementId} appears fully complete.
            </p>

            {closeoutStatus?.totals && (
              <div className="mt-3 rounded-lg border bg-gray-50 p-3 text-xs">
                <div>
                  Milestones: {closeoutStatus.totals.milestones_completed}/
                  {closeoutStatus.totals.milestones_total}
                </div>
                <div>
                  Invoices: {closeoutStatus.totals.invoices_paid}/
                  {closeoutStatus.totals.invoices_total}
                </div>
              </div>
            )}

            <p className="mt-3 text-sm text-gray-700">
              Close and archive this agreement?
            </p>

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowCloseoutModal(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold"
              >
                Not yet
              </button>
              <button
                onClick={confirmCloseout}
                disabled={closingOut}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-green-700 disabled:bg-green-400"
              >
                {closingOut ? "Closing…" : "Yes, close & archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stripeRequirement ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
            data-testid="stripe-requirement-modal"
          >
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Payments Setup Required
            </div>
            <h3 className="mt-2 text-lg font-extrabold text-slate-900">
              {stripeRequirement?.action_label || "Connect Stripe to continue"}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {stripeRequirement?.message || "You can keep exploring, but this payment action requires Stripe setup."}
            </p>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">Why this showed up</div>
              <div className="mt-1">
                {stripeRequirement?.detail || "Stripe Connect must be completed before MyHomeBro can send or receive payment-related funds."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                  Charges: {stripeRequirement?.stripe_status?.charges_enabled ? "enabled" : "not ready"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                  Payouts: {stripeRequirement?.stripe_status?.payouts_enabled ? "enabled" : "not ready"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                  Requirements due: {Number(stripeRequirement?.stripe_status?.requirements_due_count || 0)}
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStripeRequirement(null)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                Keep Exploring
              </button>
              <button
                type="button"
                data-testid="stripe-requirement-connect"
                onClick={() => {
                  const target = stripeRequirement?.resume_url || "/app/onboarding";
                  setStripeRequirement(null);
                  navigate(target);
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
              >
                Connect Stripe
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="border-b border-slate-200/90 px-4 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <img
            src={new URL("../assets/myhomebro_logo.png", import.meta.url).href}
            alt="MyHomeBro"
            className="h-9 w-9 rounded-lg object-contain"
          />
          <div>
            <div className="text-base font-extrabold tracking-tight text-slate-900">
              MyHomeBro
            </div>
            <div className="mt-0.5 text-xs font-medium text-slate-600">{consoleLabel}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 space-y-7 no-scrollbar">
        {showRefundContext && !isEmployee && (
          <RefundEscrowModal
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            agreementId={activeAgreementId}
            agreementLabel={activeAgreementLabel}
          />
        )}

        {isContractorOwner ? (
          <>
            <div>
              <button
                type="button"
                data-testid="assistant-dock-open-button"
                onClick={() =>
                  openAssistant({
                    title: "Ask AI",
                    context: { current_route: `${location.pathname}${location.search || ""}` },
                  })
                }
                className="mb-5 hidden w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-[#f7f8fa] px-3.5 py-3 text-[15px] font-bold text-slate-700 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition duration-200 hover:border-amber-200 hover:bg-white hover:text-[#18395f] hover:shadow-[0_10px_22px_rgba(15,23,42,0.08),0_0_0_1px_rgba(245,158,11,0.08)] [&>span:first-child]:hidden xl:flex"
              >
                <span aria-hidden="true">âœ¨</span>
                <Sparkles size={16} strokeWidth={2} className="shrink-0 text-[#214d7f]" />
                <span>Ask AI</span>
              </button>
            </div>

            <NavGroup label="Main">
              <Item to={`${APP_BASE}/dashboard`} label="Dashboard" icon={LayoutDashboard} />
              <Item to={`${APP_BASE}/assistant`} label="AI Workspace" icon={Bot} />
            </NavGroup>

            <NavGroup label="Work" className="pt-1">
              <Item to={`${APP_BASE}/agreements`} label="Agreements" icon={FileSignature} />
              <Item to={`${APP_BASE}/templates`} label="Templates" icon={ClipboardList} />
              <Item to={`${APP_BASE}/milestones`} label="Milestones" icon={SquareKanban} />
              <Item to={`${APP_BASE}/invoices`} label="Invoices" icon={CreditCard} />
              <Item to={`${APP_BASE}/reviewer/queue`} label="Awaiting Review" icon={SearchCheck} />
            </NavGroup>

            <NavGroup label="Team" className="pt-1">
              <Item to={`${APP_BASE}/subcontractors`} label="Subcontractors" icon={Wrench} />
              <Item to={`${APP_BASE}/assignments`} label="Assignments" icon={BriefcaseBusiness} />
              <Item to={`${APP_BASE}/team-schedule`} label="Team Schedule" icon={CalendarDays} />
              <Item to={`${APP_BASE}/team`} label="Team" icon={Users} />
            </NavGroup>

            <NavGroup label="Business" className="pt-1">
              <Item to={`${APP_BASE}/business`} label="Business Dashboard" icon={Gauge} />
              <Item to={`${APP_BASE}/customers`} label="Customers" icon={Users} />
              <Item to={`${APP_BASE}/calendar`} label="Calendar" icon={CalendarDays} />
              <Item to={`${APP_BASE}/expenses`} label="Expenses" icon={HandCoins} />
              <Item to={`${APP_BASE}/disputes`} label="Disputes" icon={MessageSquareWarning} />
              <Item to={`${APP_BASE}/public-presence`} label="Public Presence" icon={Globe} />
            </NavGroup>

            <NavGroup label="Account" className="pt-1">
              <Item to={`${APP_BASE}/profile`} label="My Profile" icon={UserRound} />
              <Item
                to={`${APP_BASE}/onboarding`}
                icon={LinkIcon}
                label={
                  <>
                    <span>Stripe Onboarding</span>
                    <StripeOnboardingStatus className="ml-2" />
                  </>
                }
              />
            </NavGroup>
          </>
        ) : null}

        {!isContractorOwner ? (
        <>
        <div>
          <div className="mb-2 px-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
            Main
          </div>
          {isContractorOwner ? (
            <button
              type="button"
              data-testid="assistant-dock-open-button"
              onClick={() =>
                openAssistant({
                  title: "Ask AI",
                  context: { current_route: `${location.pathname}${location.search || ""}` },
                })
              }
              className="mb-3 hidden w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-extrabold text-slate-800 transition hover:bg-slate-50 xl:flex"
            >
              <span aria-hidden="true">✨</span>
              Ask AI
            </button>
          ) : null}
          <div className="space-y-2">{mainNav}</div>
        </div>

        <div>
          <div className="mb-2 px-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
            Account
          </div>
          <div className="space-y-2">{accountNav}</div>
        </div>
        </>
        ) : null}
      </nav>

      <div className="border-t border-slate-200/90 px-4 py-4">
        <button
          onClick={handleLogout}
          data-close-sidebar="1"
          className="w-full rounded-xl border border-slate-200 bg-[#f7f8fa] px-3.5 py-3 text-[15px] font-semibold text-slate-700 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition duration-200 hover:bg-white hover:text-[#18395f]"
        >
          Logout
        </button>
        <div className="mt-2 text-center text-[11px] text-slate-600">
          © {new Date().getFullYear()} MyHomeBro
        </div>
      </div>
      </>
    </SidebarNavCtx.Provider>
  );

  if (variant === "plain") {
    return <div className="flex min-h-screen max-w-full overflow-x-hidden flex-col">{inner}</div>;
  }

  return (
    <aside
      className="hidden max-w-full overflow-x-hidden border-r border-slate-200/90 md:flex md:w-60 md:flex-col lg:w-64"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, rgba(252,253,255,0.94) 0%, rgba(246,248,251,0.92) 100%)",
        backdropFilter: "blur(12px)",
      }}
    >
      {inner}
    </aside>
  );
}
