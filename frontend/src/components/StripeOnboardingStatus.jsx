// ~/backend/frontend/src/components/StripeOnboardingStatus.jsx
// v2025-10-17 — tiny badge showing current onboarding status

import React, { useEffect, useState } from "react";
import api from "../api";

export default function StripeOnboardingStatus({ className = "" }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/payments/onboarding/status/");
        if (mounted) setStatus(data || null);
      } catch (e) {
        if (mounted) setStatus({ onboarding_status: "unknown" });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const s = status?.onboarding_status;
  const label =
    s === "completed" || status?.linked ? "Onboarded" :
    s === "in_progress" ? "Onboarding…" :
    s === "disabled" ? "Payments Disabled" :
    "Not Onboarded";

  const tone =
    s === "completed" || status?.linked ? "green" :
    s === "in_progress" ? "yellow" :
    s === "disabled" ? "gray" :
    "red";

  const cls =
    tone === "green" ? "bg-green-100 text-green-800" :
    tone === "yellow" ? "bg-yellow-100 text-yellow-800" :
    tone === "gray" ? "bg-gray-100 text-gray-800" :
    "bg-red-100 text-red-800";

  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${cls} ${className}`}>
      {label}
    </span>
  );
}
