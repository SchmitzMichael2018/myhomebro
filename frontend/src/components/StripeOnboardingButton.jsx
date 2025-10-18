// ~/backend/frontend/src/components/StripeOnboardingButton.jsx
// v2025-10-17 — opens Stripe Connect onboarding (no leading '/api' in paths)

import React, { useState } from "react";
import api from "../api";

export default function StripeOnboardingButton({ children = "Open Stripe Onboarding", className = "" }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleClick() {
    setErr("");
    setLoading(true);
    try {
      const res = await api.post("/payments/onboarding/start/");
      const url = res?.data?.onboarding_url || res?.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        setErr("Onboarding URL not returned by server.");
      }
    } catch (e) {
      console.error(e);
      setErr("Failed to start onboarding.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60 ${className}`}
      >
        {loading ? "Opening…" : children}
      </button>
      {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
    </div>
  );
}
