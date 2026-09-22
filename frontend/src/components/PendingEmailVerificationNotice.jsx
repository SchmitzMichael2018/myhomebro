import React, { useEffect, useReducer } from "react";

import api from "../api";
import {
  initialResendState,
  resendStateReducer,
} from "../lib/verificationResendState.js";

export default function PendingEmailVerificationNotice({
  email,
  verificationSession,
}) {
  const [state, dispatch] = useReducer(resendStateReducer, initialResendState);

  useEffect(() => {
    if (state.cooldownSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "tick" }), 1000);
    return () => window.clearTimeout(timer);
  }, [state.cooldownSeconds]);

  const resend = async () => {
    dispatch({ type: "start" });
    try {
      const { data } = await api.post(
        "/accounts/auth/verification/resend-email/",
        {
          email: String(email || "").trim().toLowerCase(),
          verification_session: verificationSession,
        }
      );
      dispatch({
        type: "success",
        message: data?.detail,
        cooldownSeconds: data?.cooldown_seconds,
      });
    } catch (error) {
      dispatch({
        type: "failure",
        message: error?.response?.data?.detail,
        cooldownSeconds: error?.response?.headers?.["retry-after"],
      });
    }
  };

  const coolingDown = state.cooldownSeconds > 0;
  const loading = state.status === "loading";

  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"
      data-testid="pending-email-verification"
    >
      <p className="text-sm font-bold">Finish setting up your account.</p>
      <button
        type="button"
        className="mt-2 w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="resend-verification-email-button"
        disabled={loading || coolingDown}
        onClick={resend}
      >
        {loading
          ? "Sending..."
          : coolingDown
            ? `Resend available in ${state.cooldownSeconds}s`
            : "Resend verification email"}
      </button>
      {state.message ? (
        <p
          className="mt-2 text-xs leading-5"
          data-testid={`verification-resend-${state.status}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
