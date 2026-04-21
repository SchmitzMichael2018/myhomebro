// frontend/src/components/StripeOnboardingStatus.jsx
// v2026-01-06 — authoritative sidebar badge for Stripe Connect onboarding
// ✅ Green only when backend says the Stripe setup is complete.

import React, { useEffect, useState } from "react";
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
