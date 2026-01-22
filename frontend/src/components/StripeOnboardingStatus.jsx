// frontend/src/components/StripeOnboardingStatus.jsx
// v2026-01-06 — authoritative sidebar badge for Stripe Connect onboarding
// ✅ Green ONLY when backend says connected:true (or legacy onboarding_status==="completed")

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

  const s = String(data?.onboarding_status || "");
  const connected = Boolean(data?.connected) || s === "completed";

  // account exists?
  const hasAccount = Boolean(data?.account_id) || Boolean(data?.linked);

  const label = connected
    ? "Connected"
    : hasAccount
    ? "Pending"
    : "Not Started";

  const cls = connected
    ? "bg-green-500 text-white"
    : hasAccount
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
