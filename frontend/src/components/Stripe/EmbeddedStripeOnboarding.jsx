import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../../api";
import { getStripePublishableKey } from "../../lib/runtimeConfig";
import ContractorPageSurface from "../dashboard/ContractorPageSurface.jsx";
import StripeOnboardingButton from "../StripeOnboardingButton.jsx";
import StripeGuidanceSidebar from "./StripeGuidanceSidebar.jsx";
import { readEntityTypeFromSession } from "../../lib/stripeGuidanceContent.js";

const CONNECT_SCRIPT_SRC = "https://connect-js.stripe.com/v1.0/connect.js";

function loadConnectJs() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Stripe Connect can only load in the browser."));
  }

  if (window.StripeConnect?.init) {
    return Promise.resolve(window.StripeConnect);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-stripe-connect="1"]');
    if (existing) {
      existing.addEventListener(
        "load",
        () => resolve(window.StripeConnect),
        { once: true }
      );
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Stripe Connect.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CONNECT_SCRIPT_SRC;
    script.async = true;
    script.dataset.stripeConnect = "1";
    script.onload = () => resolve(window.StripeConnect);
    script.onerror = () => reject(new Error("Failed to load Stripe Connect."));
    document.head.appendChild(script);
  });
}

function StepBadge({ active, done, children }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${
        done
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? "bg-emerald-600 text-white"
            : active
            ? "bg-white/15 text-white"
            : "bg-white text-slate-500"
        }`}
      >
        {done ? "Done" : children === "Step 1" ? "1" : "2"}
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function EmbeddedStripeOnboarding() {
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [accountSession, setAccountSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [embedding, setEmbedding] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [stepHint, setStepHint] = useState("Preparing account session");
  const [currentStripeStep, setCurrentStripeStep] = useState("");
  const [resumeUrl, setResumeUrl] = useState("/app/onboarding/stripe");
  const [entityType] = useState(() => readEntityTypeFromSession());

  async function refreshStatus() {
    const { data } = await api.get("/payments/onboarding/status/");
    setStatus(data || null);
    setResumeUrl(data?.resume_url || "/app/onboarding/stripe");
    if (data?.connected) {
      setCompleted(true);
      setEmbedding(false);
      setStepHint("Stripe onboarding complete");
    }
    return data || null;
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setEmbedding(false);
      setError("");
      setCompleted(false);
      setStepHint("Preparing account session");

      try {
        const initialStatus = await refreshStatus();
        if (!active) return;
        if (initialStatus?.connected) {
          setLoading(false);
          return;
        }

        setStepHint("Loading embedded Stripe onboarding");
        const sessionRes = await api.post("/payments/onboarding/account-session/");
        if (!active) return;

        const sessionData = sessionRes?.data || {};
        setAccountSession(sessionData);

        const stripeConnect = await loadConnectJs();
        if (!active) return;

        const publishableKey = getStripePublishableKey();
        if (!publishableKey) {
          throw new Error("Missing Stripe publishable key.");
        }
        if (!stripeConnect?.init) {
          throw new Error("Stripe Connect is unavailable.");
        }

        const instance = stripeConnect.init({
          publishableKey,
          fetchClientSecret: async () => sessionData.client_secret,
        });

        const accountOnboarding = instance.create("account-onboarding");
        if (typeof accountOnboarding.setOnStepChange === "function") {
          accountOnboarding.setOnStepChange(({ step }) => {
            if (typeof step === "string" && step.trim()) {
              setCurrentStripeStep(step);
              setStepHint(step.replace(/_/g, " "));
            }
          });
        }

        if (typeof accountOnboarding.setOnExit === "function") {
          accountOnboarding.setOnExit(async () => {
            try {
              await refreshStatus();
            } catch (err) {
              setError("Stripe onboarding exited, but we could not confirm completion yet.");
            }
          });
        }

        if (mountRef.current) {
          mountRef.current.replaceChildren(accountOnboarding);
        }

        setEmbedding(true);
        setLoading(false);
        setStepHint("Complete your payment setup");
      } catch (err) {
        if (!active) return;
        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Unable to load embedded Stripe onboarding."
        );
        setLoading(false);
        setEmbedding(false);
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const progressValue = completed ? 100 : embedding ? 66 : loading ? 33 : 50;

  return (
    <ContractorPageSurface
      eyebrow="Payments"
      title="Stripe Onboarding"
      subtitle="Finish payment setup without leaving MyHomeBro."
      variant="operational"
      contentClassName="mx-auto max-w-5xl"
    >
      <div data-testid="embedded-stripe-onboarding-page">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Stripe Connect
              </div>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                Finish payment setup without leaving MyHomeBro
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Embedded onboarding keeps you in the app while Stripe collects the remaining account details it needs.
              </p>
            </div>
            <div className="space-y-2">
              <StepBadge active={!completed} done={completed}>
                Step 1
              </StepBadge>
              <StepBadge active={embedding && !completed} done={completed}>
                Step 2
              </StepBadge>
            </div>
          </div>

          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${Math.max(20, Math.min(100, progressValue))}%` }}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {stepHint}
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.43fr)]">
            <div className="space-y-4">
              {completed ? (
                <div
                  className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6"
                  data-testid="embedded-stripe-success"
                >
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    Complete
                  </div>
                  <div className="mt-2 text-2xl font-bold text-emerald-950">
                    Your Stripe account is ready.
                  </div>
                  <p className="mt-2 text-sm text-emerald-900/80">
                    You can now receive payments and continue building projects inside MyHomeBro.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => navigate("/app/dashboard")}
                      className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                    >
                      Go to dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/app/profile")}
                      className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
                    >
                      Review profile
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-3xl border border-slate-200 bg-white p-5">
                    <div className="text-sm font-semibold text-slate-900">Step 1</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">
                      Account session prepared
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {loading
                        ? "We are preparing your secure Stripe session."
                        : "Your embedded Stripe onboarding is ready inside the app."}
                    </div>
                    {accountSession?.account_id ? (
                      <div className="mt-3 text-xs text-slate-500">
                        Connected account: <span className="font-semibold text-slate-700">{accountSession.account_id}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Step 2</div>
                        <div className="mt-1 text-lg font-bold text-slate-900">
                          Complete onboarding
                        </div>
                        <div className="mt-2 text-sm text-slate-600">
                          Stripe&apos;s embedded component renders here and keeps you inside MyHomeBro.
                        </div>
                      </div>
                      {loading ? (
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Loading
                        </div>
                      ) : null}
                    </div>

                    {!embedding && !completed ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
                        <div className="flex h-[500px] items-center justify-center text-sm text-slate-500">
                          {loading
                            ? "Loading embedded onboarding..."
                            : "Embedded onboarding could not be loaded yet."}
                        </div>
                      </div>
                    ) : null}
                    <div
                      ref={mountRef}
                      data-testid="embedded-stripe-connect-container"
                      className="mt-4 min-h-[540px] rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4">
              <StripeGuidanceSidebar
                step={currentStripeStep}
                entityType={entityType}
              />
              {!completed ? (
                <div
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  data-testid="embedded-stripe-fallback"
                >
                  <div className="text-xs font-semibold text-slate-500">
                    If the embedded flow isn't loading
                  </div>
                  <div className="mt-2">
                    <StripeOnboardingButton
                      dataTestId="embedded-stripe-hosted-fallback"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Open hosted onboarding instead
                    </StripeOnboardingButton>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </ContractorPageSurface>
  );
}
