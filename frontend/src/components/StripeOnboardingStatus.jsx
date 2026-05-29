// frontend/src/components/StripeOnboardingStatus.jsx
// v2026-01-06 — authoritative sidebar badge for Stripe Connect onboarding
// ✅ Green only when backend says the Stripe setup is complete.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function StripeOnboardingStatus({ className = "" }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/payments/onboarding/status/");
        if (mounted) setData(res.data || null);
      } catch (e) {
        if (mounted) setData({ onboarding_status: "unknown", connected: false });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const s = String(data?.stripe_onboarding_status || data?.onboarding_status || "").toLowerCase();
  const complete = Boolean(data?.connected) || s === "complete" || s === "completed";
  const restricted = s === "restricted";
  const inProgress = s === "in_progress" || s === "incomplete" || (!!data?.account_id && !complete && !restricted);
  const label = complete
    ? "Connected"
    : restricted
    ? "Update"
    : inProgress
    ? "Resume"
    : "Start setup";

  const cls = complete
    ? "bg-green-500 text-white"
    : restricted
    ? "bg-rose-500 text-white"
    : inProgress
    ? "bg-amber-400 text-black"
    : "bg-gray-200 text-gray-800";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-[1px] text-[10px] ${cls} ${className}`}
      title={
        data
          ? `status=${s} connected=${String(Boolean(data.connected))} account_id=${data.account_id || ""}`
          : "Stripe status"
      }
    >
      {label}
    </span>
  );
}

/**
 * Copilot-style status message shown in the AI assistant panel or dashboard.
 * Renders nothing when Stripe is fully connected and charges are enabled.
 */
export function StripeStatusCopilotMessage({ className = "" }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/payments/onboarding/status/");
        if (mounted) setData(res.data || null);
      } catch {
        if (mounted) setData(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!data) return null;

  const s = String(data?.stripe_onboarding_status || data?.onboarding_status || "").toLowerCase();
  const complete = Boolean(data?.connected) || s === "complete" || s === "completed";
  const chargesEnabled = Boolean(data?.stripe_status?.charges_enabled ?? data?.charges_enabled);
  const restricted = s === "restricted";
  const inProgress = s === "in_progress" || s === "incomplete" || (!!data?.account_id && !complete && !restricted);
  const resumeUrl = String(data?.resume_url || "/app/onboarding/stripe");

  // No message when fully connected and charges are working
  if (complete && chargesEnabled) return null;

  let message, ctaLabel, tone;

  if (complete && !chargesEnabled) {
    message = "Your Stripe account is connected but payouts aren't enabled yet. Let me check what's needed.";
    ctaLabel = "Review payout setup";
    tone = "warn";
  } else if (restricted) {
    message = "Stripe has flagged something on your account that needs attention. Let me walk you through it.";
    ctaLabel = "Resolve restriction";
    tone = "warn";
  } else if (inProgress) {
    message = "You started connecting your bank. Want to finish? Stripe saved your progress.";
    ctaLabel = "Finish setup";
    tone = "nudge";
  } else {
    message = "Connect your bank to start receiving payments — takes 2 minutes.";
    ctaLabel = "Connect my bank";
    tone = "nudge";
  }

  const wrapperCls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50"
      : "border-sky-200 bg-sky-50";
  const textCls = tone === "warn" ? "text-amber-900" : "text-sky-900";
  const btnCls =
    tone === "warn"
      ? "bg-amber-700 text-white hover:bg-amber-800"
      : "bg-slate-900 text-white hover:bg-slate-800";

  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${wrapperCls} ${className}`}
      data-testid="stripe-copilot-status-message"
    >
      <div className={`text-sm leading-6 ${textCls}`}>{message}</div>
      <button
        type="button"
        onClick={() => navigate(resumeUrl)}
        className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${btnCls}`}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
