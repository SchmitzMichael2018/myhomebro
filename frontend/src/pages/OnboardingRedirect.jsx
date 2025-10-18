// ~/backend/frontend/src/pages/OnboardingRedirect.jsx
// v2025-10-17 — immediately starts onboarding then redirects user

import React, { useEffect, useState } from "react";
import api from "../api";

export default function OnboardingRedirect() {
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.post("/payments/onboarding/start/");
        const url = res?.data?.onboarding_url || res?.data?.url;
        if (url) {
          window.location.href = url;
        } else {
          setErr("No onboarding URL returned from server.");
        }
      } catch (e) {
        console.error(e);
        setErr("Failed to start onboarding.");
      }
    })();
  }, []);

  return (
    <div className="mx-auto mt-16 max-w-xl rounded bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-bold">Preparing Stripe Onboarding…</h2>
      <p className="text-gray-600">You’ll be redirected to Stripe to continue.</p>
      {err && <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>}
    </div>
  );
}
