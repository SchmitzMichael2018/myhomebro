import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { loadRequiredOnboarding } from "../lib/contractorOnboardingRoute.js";

export default function ContractorOnboardingGate({ children }) {
  const [state, setState] = useState({ status: "loading", retryKey: 0 });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: "loading" }));
    loadRequiredOnboarding()
      .then((onboarding) => {
        if (active) setState((current) => ({ ...current, status: "ready", onboarding }));
      })
      .catch(() => {
        if (active) setState((current) => ({ ...current, status: "error" }));
      });
    return () => {
      active = false;
    };
  }, [state.retryKey]);

  if (state.status === "loading") {
    return (
      <main className="grid min-h-[50vh] place-items-center p-6" role="status">
        <p className="text-sm text-[var(--mhb-text-secondary)]">Checking your setup progress…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="grid min-h-[50vh] place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-6 text-center">
          <h1 className="text-xl font-bold text-[var(--mhb-text-primary)]">We couldn’t verify your setup progress</h1>
          <p className="mt-2 text-sm text-[var(--mhb-text-secondary)]">
            Your dashboard has not been opened. Retry when your connection is available.
          </p>
          <button
            type="button"
            className="mt-5 min-h-11 rounded-xl bg-[var(--mhb-interactive-primary)] px-5 font-bold text-white"
            onClick={() => setState((current) => ({ ...current, retryKey: current.retryKey + 1 }))}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!state.onboarding.requiredComplete) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}
