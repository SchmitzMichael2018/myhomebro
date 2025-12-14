// src/components/Sidebar.jsx
// COMPLETE FILE — Sidebar with Stripe status badge + Team nav item
// + v2025-12-13 — Contextual "Refund Escrow" button on Agreement pages (contractor owner only)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI.js";
import RefundEscrowModal from "./RefundEscrowModal";

/**
 * Compact, route-aligned sidebar.
 * - Highlights active route via NavLink
 * - Includes "My Profile"
 * - Logout button (clears JWT and returns to landing)
 * - Shows Stripe onboarding status badge (Connected / Pending) for contractors only
 * - Includes "Team" link for contractor employee management
 * - NEW: Context section with "Refund Escrow" button when viewing an agreement (owner only)
 */
export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const { data, loading: whoLoading, error: whoError, isContractor, isEmployee } =
    useWhoAmI();

  const [stripeStatus, setStripeStatus] = useState({
    connected: false,
    status: "",
    loading: true,
    error: "",
  });

  const [refundOpen, setRefundOpen] = useState(false);

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

  // Determine if this user is the "parent contractor owner"
  // (you mentioned whoami shows role: contractor_owner)
  const isContractorOwner = useMemo(() => {
    const role = data?.role || data?.type || "";
    return isContractor && String(role).toLowerCase() === "contractor_owner";
  }, [data, isContractor]);

  // Extract agreement id from URL if on /agreements/:id or /agreements/:id/wizard...
  const activeAgreementId = useMemo(() => {
    const p = location.pathname || "";
    const m = p.match(/^\/agreements\/(\d+)(\/|$)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

  // Optional: show a label if AgreementDetail stored it (nice UX, not required)
  const activeAgreementLabel = useMemo(() => {
    try {
      return localStorage.getItem("activeAgreementTitle") || "";
    } catch {
      return "";
    }
  }, [location.pathname]);

  // Fetch Stripe status ONLY for contractor accounts
  useEffect(() => {
    let isMounted = true;

    // If we don't know the role yet, or there's an error, skip Stripe.
    if (whoLoading || whoError || !isContractor) {
      if (isMounted) {
        setStripeStatus((s) => ({
          ...s,
          loading: false,
        }));
      }
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const { data } = await api.get("/payments/onboarding/status/");
        const status = String(data?.onboarding_status || "");
        const connected = Boolean(
          data?.linked || data?.connected || status === "completed"
        );
        if (isMounted) {
          setStripeStatus({
            connected,
            status,
            loading: false,
            error: "",
          });
        }
      } catch (err) {
        console.error(err);
        if (isMounted) {
          setStripeStatus((s) => ({
            ...s,
            loading: false,
            error: "Failed to load Stripe status",
          }));
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isContractor, whoLoading, whoError]);

  const StripeBadge = () => {
    if (!isContractor) return null;

    if (stripeStatus.loading) {
      return (
        <span className="ml-2 inline-flex items-center rounded-full px-2 py-[1px] text-[10px] bg-gray-200 text-gray-700">
          Checking…
        </span>
      );
    }
    if (stripeStatus.connected) {
      return (
        <span className="ml-2 inline-flex items-center rounded-full px-2 py-[1px] text-[10px] bg-green-500 text-white">
          Connected
        </span>
      );
    }
    const label = stripeStatus.status
      ? stripeStatus.status.charAt(0).toUpperCase() +
        stripeStatus.status.slice(1)
      : "Pending";
    return (
      <span className="ml-2 inline-flex items-center rounded-full px-2 py-[1px] text-[10px] bg-amber-400 text-black">
        {label}
      </span>
    );
  };

  const Item = ({ to, label, emoji, title }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
          "text-slate-700 hover:bg-white hover:text-slate-900",
          isActive
            ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5"
            : "bg-white/60",
        ].join(" ")
      }
      end={to === "/dashboard"}
      title={title || (typeof label === "string" ? label : undefined)}
    >
      <span className="text-base" aria-hidden="true">
        {emoji}
      </span>
      <span className="flex items-center">{label}</span>
    </NavLink>
  );

  const showRefundContext = Boolean(isContractorOwner && activeAgreementId);

  return (
    <aside
      className="hidden md:flex md:flex-col md:w-60 lg:w-64 border-r border-black/5 bg-white/50 backdrop-blur-md"
      style={{ minHeight: "100vh" }}
    >
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <div className="flex items-center gap-2">
          <img
            src={new URL("../assets/myhomebro_logo.png", import.meta.url).href}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            alt="MyHomeBro"
            className="h-8 w-8 rounded-md object-contain"
          />
          <div>
            <div className="text-base font-extrabold tracking-tight text-slate-900">
              MyHomeBro
            </div>
            <div className="text-xs text-slate-500">Contractor Console</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-auto px-3 py-4 space-y-6">
        {showRefundContext && (
          <div>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Context
            </div>

            <div className="rounded-xl bg-white/70 ring-1 ring-black/5 p-3 space-y-2">
              <div className="text-xs text-slate-600">
                Agreement{" "}
                <span className="font-extrabold text-slate-900">
                  #{activeAgreementId}
                </span>
                {activeAgreementLabel ? (
                  <div className="text-[11px] text-slate-500 truncate" title={activeAgreementLabel}>
                    {activeAgreementLabel}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setRefundOpen(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-extrabold px-3 py-2 shadow-sm ring-1 ring-black/5"
                title="Refund escrow for this agreement (unreleased funds only)"
              >
                <span aria-hidden="true">↩︎</span>
                <span>Refund Escrow</span>
              </button>

              <div className="text-[11px] text-slate-500">
                Owner-only. Refunds unreleased escrow.
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Main
          </div>
          <div className="space-y-1">
            <Item to="/dashboard" label="Dashboard" emoji="🏠" />
            <Item to="/agreements" label="Agreements" emoji="📄" />
            <Item to="/milestones" label="Milestones" emoji="🧩" />
            {isContractor && <Item to="/team" label="Team" emoji="🧑‍🤝‍🧑" />}
            <Item to="/invoices" label="Invoices" emoji="💳" />
            <Item to="/customers" label="Customers" emoji="👥" />
            <Item to="/calendar" label="Calendar" emoji="🗓️" />
            <Item to="/expenses" label="Expenses" emoji="📊" />
            <Item to="/disputes" label="Disputes" emoji="⚖️" />
            <Item to="/business-analysis" label="Business Dashboard" emoji="📈" />
          </div>
        </div>

        <div>
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Account
          </div>
          <div className="space-y-1">
            <Item to="/profile" label="My Profile" emoji="👤" />
            {isContractor && (
              <Item
                to="/onboarding"
                emoji="🔗"
                title="Stripe Onboarding"
                label={
                  <>
                    <span>Stripe Onboarding</span>
                    <StripeBadge />
                  </>
                }
              />
            )}
          </div>
        </div>
      </nav>

      <div className="px-4 py-3 border-t border-black/5">
        <button
          type="button"
          onClick={handleLogout}
          title="Logout"
          className="w-full flex items-center justify-center gap-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-extrabold px-3 py-2 shadow-sm ring-1 ring-black/5"
        >
          <span aria-hidden="true">↩︎</span>
          <span>Logout</span>
        </button>
        <div className="mt-2 text-[11px] text-slate-500 text-center">
          © {new Date().getFullYear()} MyHomeBro
        </div>
      </div>

      <RefundEscrowModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        agreementId={activeAgreementId}
        agreementLabel={activeAgreementLabel}
      />
    </aside>
  );
}
