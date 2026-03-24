// src/components/Sidebar.jsx
// v2026-03-15 — add Templates nav item
// - Default export remains DESKTOP sidebar (hidden on mobile) to avoid desktop breakage
// - Add `variant="plain"` to render sidebar CONTENT only (for mobile overlay shell)

import React, { useCallback, useMemo, useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import api, { getAgreementClosureStatus, closeAndArchiveAgreement } from "../api";
import toast from "react-hot-toast";
import { useWhoAmI } from "../hooks/useWhoAmI.js";
import RefundEscrowModal from "./RefundEscrowModal";
import StripeOnboardingStatus from "./StripeOnboardingStatus";

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

  const [refundOpen, setRefundOpen] = useState(false);

  // Global close-out modal state
  const [showCloseoutModal, setShowCloseoutModal] = useState(false);
  const [closeoutAgreementId, setCloseoutAgreementId] = useState(null);
  const [closeoutStatus, setCloseoutStatus] = useState(null);
  const [closingOut, setClosingOut] = useState(false);

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

  // Primary item (MAIN section)
  const Item = ({ to, label, emoji, title }) => (
    <NavLink
      to={to}
      data-close-sidebar="1"
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
          "border",
          isActive
            ? "bg-slate-900 text-white border-black/10 shadow-sm"
            : "bg-white/60 text-slate-800 border-black/10 hover:bg-white hover:text-slate-900",
        ].join(" ")
      }
      title={title || (typeof label === "string" ? label : undefined)}
    >
      <span className="text-base" aria-hidden="true">
        {emoji}
      </span>
      <span className="flex items-center">{label}</span>
    </NavLink>
  );

  // Admin nested item
  const SubItem = ({ to, label }) => (
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
      <span className="text-[10px] opacity-70">•</span>
      <span>{label}</span>
    </NavLink>
  );

  const mainNav = useMemo(() => {
    if (isAdmin) {
      return (
        <>
          <Item to={`${APP_BASE}/admin`} label="Admin" emoji="🛠️" />
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
          <Item to={`${EMP_BASE}/dashboard`} label="Dashboard" emoji="🏠" />
          {canAccessReviewerQueue ? (
            <Item to={`${APP_BASE}/reviewer/queue`} label="Awaiting Review" emoji="🔍" />
          ) : null}
          <Item to={`${EMP_BASE}/agreements`} label="My Agreements" emoji="📄" />
          <Item to={`${EMP_BASE}/milestones`} label="Milestones" emoji="🧩" />
          <Item to={`${EMP_BASE}/calendar`} label="Calendar" emoji="🗓️" />
        </>
      );
    }

    if (isSubcontractor) {
      return (
        <>
          <Item to={`${APP_BASE}/subcontractor/assigned-work`} label="My Assigned Work" emoji="🧰" />
        </>
      );
    }

    return (
      <>
        <Item to={`${APP_BASE}/dashboard`} label="Dashboard" emoji="🏠" />
        <Item to={`${APP_BASE}/business`} label="Business Dashboard" emoji="📈" />
        <Item to={`${APP_BASE}/reviewer/queue`} label="Awaiting Review" emoji="🔍" />
        <Item to={`${APP_BASE}/agreements`} label="Agreements" emoji="📄" />
        <Item to={`${APP_BASE}/templates`} label="Templates" emoji="🧱" />
        <Item to={`${APP_BASE}/milestones`} label="Milestones" emoji="🧩" />
        <Item to={`${APP_BASE}/assignments`} label="Assignments" emoji="🧭" />
        <Item to={`${APP_BASE}/team-schedule`} label="Team Schedule" emoji="🧑‍🏭" />
        <Item to={`${APP_BASE}/team`} label="Team" emoji="🧑‍🤝‍🧑" />
        <Item to={`${APP_BASE}/invoices`} label="Invoices" emoji="💳" />
        <Item to={`${APP_BASE}/customers`} label="Customers" emoji="👥" />
        <Item to={`${APP_BASE}/calendar`} label="Calendar" emoji="🗓️" />
        <Item to={`${APP_BASE}/expenses`} label="Expenses" emoji="📊" />
        <Item to={`${APP_BASE}/disputes`} label="Disputes" emoji="⚖️" />
      </>
    );
  }, [canAccessReviewerQueue, isEmployee, isAdmin, isOnAdminRoute, isSubcontractor]);

  const accountNav = useMemo(() => {
    if (isAdmin) {
      return <Item to={`${APP_BASE}/admin`} label="Admin Home" emoji="🛠️" />;
    }

    if (isEmployee) {
      return <Item to={`${EMP_BASE}/profile`} label="My Profile" emoji="👤" />;
    }

    if (isSubcontractor) {
      return null;
    }

    return (
      <>
        <Item to={`${APP_BASE}/profile`} label="My Profile" emoji="👤" />
        <Item
          to={`${APP_BASE}/onboarding`}
          emoji="🔗"
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
    <>
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

      <div className="px-4 pt-4 pb-3 border-b border-black/10">
        <div className="flex items-center gap-2">
          <img
            src={new URL("../assets/myhomebro_logo.png", import.meta.url).href}
            alt="MyHomeBro"
            className="h-8 w-8 rounded-md object-contain"
          />
          <div>
            <div className="text-base font-extrabold tracking-tight text-slate-900">
              MyHomeBro
            </div>
            <div className="text-xs text-slate-600">{consoleLabel}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-auto px-3 py-4 space-y-6">
        {showRefundContext && !isEmployee && (
          <RefundEscrowModal
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            agreementId={activeAgreementId}
            agreementLabel={activeAgreementLabel}
          />
        )}

        <div>
          <div className="px-2 text-xs font-extrabold uppercase tracking-wide text-slate-600 mb-2">
            Main
          </div>
          <div className="space-y-2">{mainNav}</div>
        </div>

        <div>
          <div className="px-2 text-xs font-extrabold uppercase tracking-wide text-slate-600 mb-2">
            Account
          </div>
          <div className="space-y-2">{accountNav}</div>
        </div>
      </nav>

      <div className="px-4 py-3 border-t border-black/10">
        <button
          onClick={handleLogout}
          data-close-sidebar="1"
          className="w-full rounded-xl bg-rose-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-rose-700"
        >
          Logout
        </button>
        <div className="mt-2 text-[11px] text-slate-600 text-center">
          © {new Date().getFullYear()} MyHomeBro
        </div>
      </div>
    </>
  );

  if (variant === "plain") {
    return <div className="flex flex-col min-h-screen">{inner}</div>;
  }

  return (
    <aside
      className="hidden md:flex md:flex-col md:w-60 lg:w-64 border-r border-black/10"
      style={{
        minHeight: "100vh",
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(10px)",
      }}
    >
      {inner}
    </aside>
  );
}
