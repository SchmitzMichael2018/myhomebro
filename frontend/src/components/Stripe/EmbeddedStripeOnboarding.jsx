import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useNavigate } from "react-router-dom";

import api from "../../api";
import { getStripePublishableKey } from "../../lib/runtimeConfig";
import ContractorPageSurface from "../dashboard/ContractorPageSurface.jsx";
import StripeGuidanceSidebar from "./StripeGuidanceSidebar.jsx";
import { readEntityTypeFromSession } from "../../lib/stripeGuidanceContent.js";

const PHASE = {
  INITIALIZING: "initializing",
  READY: "ready",
  ERROR: "error",
  HOSTED_LAUNCHING: "hosted_launching",
  STATUS_UNAVAILABLE: "status_unavailable",
  COMPLETE: "complete",
};

const EMBEDDED_TIMEOUT_MS = 15000;

function maskAccountId(value) {
  const id = String(value || "");
  if (!id) return "Unavailable";
  return `${id.slice(0, 5)}...${id.slice(-4)}`;
}

function safeSupportReference(loadError) {
  const type = String(loadError?.error?.type || "render_error")
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 40);
  return `CONNECT-${type || "render_error"}`.toUpperCase();
}

function isSecureStripeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

function StatusItem({ label, complete, detail }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${
          complete
            ? "bg-emerald-500 text-slate-950"
            : "border border-[var(--mhb-border-strong)] text-[var(--mhb-text-muted)]"
        }`}
      >
        {complete ? "✓" : "—"}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--mhb-text-primary)]">{label}</span>
        {detail ? <span className="mt-0.5 block text-xs text-[var(--mhb-text-secondary)]">{detail}</span> : null}
      </span>
    </li>
  );
}

export default function EmbeddedStripeOnboarding() {
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const mountedRef = useRef(false);
  const secretRequestRef = useRef(null);
  const initializationRef = useRef(false);
  const hostedRequestRef = useRef(false);
  const timeoutRef = useRef(null);
  const [phase, setPhase] = useState(PHASE.INITIALIZING);
  const [status, setStatus] = useState(null);
  const [accountId, setAccountId] = useState("");
  const [currentStripeStep, setCurrentStripeStep] = useState("");
  const [supportReference, setSupportReference] = useState("");
  const [showHostedConfirmation, setShowHostedConfirmation] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [entityType] = useState(() => readEntityTypeFromSession());

  const requestFreshClientSecret = useCallback(() => {
    if (secretRequestRef.current) return secretRequestRef.current;
    const request = api
      .post("/payments/onboarding/account-session/")
      .then(({ data }) => {
        const secret = data?.client_secret;
        if (!secret || typeof secret !== "string") {
          throw new Error("Account session was unavailable.");
        }
        if (mountedRef.current) setAccountId(data?.account_id || "");
        return secret;
      })
      .finally(() => {
        if (secretRequestRef.current === request) secretRequestRef.current = null;
      });
    secretRequestRef.current = request;
    return request;
  }, []);

  const refreshStatus = useCallback(async () => {
    const { data } = await api.get("/payments/onboarding/status/");
    if (!mountedRef.current) return data || null;
    setStatus(data || null);
    setAccountId(data?.account_id || "");
    return data || null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    initializationRef.current = true;
    setPhase(PHASE.INITIALIZING);
    setSupportReference("");
    setCurrentStripeStep("");
    setShowHostedConfirmation(false);
    mountRef.current?.replaceChildren();

    async function initialize() {
      let initialStatus;
      try {
        initialStatus = await refreshStatus();
      } catch {
        if (active) setPhase(PHASE.STATUS_UNAVAILABLE);
        initializationRef.current = false;
        return;
      }
      if (!active) return;
      if (initialStatus?.connected) {
        setPhase(PHASE.COMPLETE);
        initializationRef.current = false;
        return;
      }

      const publishableKey = getStripePublishableKey();
      if (!publishableKey) {
        setSupportReference("CONNECT-CONFIGURATION");
        setPhase(PHASE.ERROR);
        initializationRef.current = false;
        return;
      }

      try {
        const instance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret: requestFreshClientSecret,
          appearance: {
            overlays: "dialog",
            variables: { colorPrimary: "#60a5fa", colorBackground: "#081a31", colorText: "#f8fbff" },
          },
        });

        // The SDK creates a promise for each component callback registration.
        // Wait for its single loader promise first so a blocked Connect.js request
        // is caught here instead of fanning out into repeated unhandled rejections.
        if (typeof instance.debugInstance === "function") {
          await instance.debugInstance();
        }
        if (!active) return;
        const onboarding = instance.create("account-onboarding");

        onboarding.setOnLoaderStart?.(() => {
          if (!active) return;
          clearTimeout(timeoutRef.current);
          setPhase(PHASE.READY);
          initializationRef.current = false;
        });
        onboarding.setOnLoadError?.((loadError) => {
          if (!active) return;
          clearTimeout(timeoutRef.current);
          setSupportReference(safeSupportReference(loadError));
          mountRef.current?.replaceChildren();
          setPhase(PHASE.ERROR);
          initializationRef.current = false;
        });
        onboarding.setOnStepChange?.(({ step }) => {
          if (active && typeof step === "string") setCurrentStripeStep(step);
        });
        onboarding.setOnExit?.(async () => {
          try {
            const nextStatus = await refreshStatus();
            if (active && nextStatus?.connected) setPhase(PHASE.COMPLETE);
          } catch {
            if (active) setPhase(PHASE.STATUS_UNAVAILABLE);
          }
        });

        if (!mountRef.current) throw new Error("Embedded mount is unavailable.");
        mountRef.current.replaceChildren(onboarding);
        timeoutRef.current = window.setTimeout(() => {
          if (!active || !initializationRef.current) return;
          setSupportReference("CONNECT-LOAD-TIMEOUT");
          mountRef.current?.replaceChildren();
          setPhase(PHASE.ERROR);
          initializationRef.current = false;
        }, EMBEDDED_TIMEOUT_MS);
      } catch {
        if (!active) return;
        setSupportReference("CONNECT-INITIALIZATION");
        mountRef.current?.replaceChildren();
        setPhase(PHASE.ERROR);
        initializationRef.current = false;
      }
    }

    initialize();
    return () => {
      active = false;
      clearTimeout(timeoutRef.current);
      mountRef.current?.replaceChildren();
    };
  }, [attempt, refreshStatus, requestFreshClientSecret]);

  function retryEmbedded() {
    if (initializationRef.current || phase === PHASE.HOSTED_LAUNCHING) return;
    setAttempt((value) => value + 1);
  }

  async function launchHosted() {
    if (hostedRequestRef.current) return;
    hostedRequestRef.current = true;
    setPhase(PHASE.HOSTED_LAUNCHING);
    try {
      const { data } = await api.post("/payments/onboarding/start/");
      const url = data?.onboarding_url || data?.url;
      if (!isSecureStripeUrl(url)) throw new Error("Unsafe hosted onboarding URL.");
      window.location.assign(url);
    } catch {
      hostedRequestRef.current = false;
      setSupportReference("CONNECT-HOSTED-FALLBACK");
      setShowHostedConfirmation(false);
      setPhase(PHASE.ERROR);
    }
  }

  const requirementsDue = Number(status?.currently_due?.length || status?.requirements_due_count || 0);
  const isComplete = phase === PHASE.COMPLETE;

  return (
    <ContractorPageSurface
      eyebrow="Payments"
      title="Stripe Onboarding"
      subtitle="Finish payment setup without leaving MyHomeBro. Stripe remains optional until you use payment workflows."
      variant="operational"
      className="!pt-16 md:!pt-3"
      contentClassName="mx-auto max-w-5xl"
    >
      <div data-testid="embedded-stripe-onboarding-page" className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.38fr)]">
        <main className="min-w-0 rounded-3xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-5 shadow-[var(--mhb-shadow-card)] sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--mhb-text-muted)]">Stripe Connect</div>
          <h1 className="mt-2 text-2xl font-bold text-[var(--mhb-text-primary)] sm:text-3xl">Set up payments securely</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--mhb-text-secondary)]">
            Stripe securely collects the business, identity, and payout details needed for payment processing.
          </p>

          {phase === PHASE.INITIALIZING ? (
            <section className="mt-6 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-5" data-testid="embedded-stripe-loading" aria-live="polite">
              <div className="font-bold text-[var(--mhb-text-primary)]">Loading secure Stripe setup</div>
              <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">Preparing a fresh account session for your existing payment account.</p>
            </section>
          ) : null}

          <section className={`mt-6 min-w-0 ${phase === PHASE.READY ? "block" : "hidden"}`} data-testid="embedded-stripe-ready">
            <div className="mb-3 text-sm font-bold text-[var(--mhb-text-primary)]">Complete your payment details</div>
            <div ref={mountRef} data-testid="embedded-stripe-connect-container" className="min-w-0 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3" />
          </section>

          {phase === PHASE.ERROR ? (
            <section className="mt-6 rounded-2xl border border-[var(--mhb-status-required-border)] bg-[var(--mhb-status-required-bg)] p-5" data-testid="embedded-stripe-error" role="alert">
              <h2 className="text-lg font-bold text-[var(--mhb-status-required-text)]">Stripe setup could not be loaded</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--mhb-status-required-text)]">You can try the embedded setup again or continue securely on Stripe.</p>
              {supportReference ? <p className="mt-2 text-xs text-[var(--mhb-status-required-text)]">Support reference: {supportReference}</p> : null}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={retryEmbedded} data-testid="embedded-stripe-retry" className="min-h-11 rounded-xl border border-[var(--mhb-border-strong)] bg-[var(--mhb-interactive-secondary)] px-4 text-sm font-bold text-[var(--mhb-text-primary)] hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Try again</button>
                <button type="button" onClick={() => setShowHostedConfirmation(true)} data-testid="embedded-stripe-hosted-fallback" className="min-h-11 rounded-xl bg-[var(--mhb-interactive-primary)] px-4 text-sm font-bold text-[var(--mhb-text-inverse)] hover:bg-[var(--mhb-interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Open secure Stripe setup</button>
              </div>
            </section>
          ) : null}

          {phase === PHASE.STATUS_UNAVAILABLE ? (
            <section className="mt-6 rounded-2xl border border-[var(--mhb-status-blocked-border)] bg-[var(--mhb-status-blocked-bg)] p-5" data-testid="embedded-stripe-status-unavailable" role="alert">
              <h2 className="font-bold text-[var(--mhb-status-blocked-text)]">Payment status is temporarily unavailable</h2>
              <p className="mt-1 text-sm text-[var(--mhb-status-blocked-text)]">No account changes were made. Try checking your status again.</p>
              <button type="button" onClick={retryEmbedded} className="mt-4 min-h-11 rounded-xl border border-[var(--mhb-status-blocked-border)] px-4 text-sm font-bold text-[var(--mhb-status-blocked-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Try again</button>
            </section>
          ) : null}

          {phase === PHASE.HOSTED_LAUNCHING ? (
            <section className="mt-6 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-5" data-testid="embedded-stripe-hosted-launching" aria-live="polite">
              <div className="font-bold text-[var(--mhb-text-primary)]">Opening secure Stripe setup</div>
              <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">Please wait while Stripe prepares the hosted setup for this payment account.</p>
            </section>
          ) : null}

          {isComplete ? (
            <section className="mt-6 rounded-2xl border border-[var(--mhb-status-complete-border)] bg-[var(--mhb-status-complete-bg)] p-5" data-testid="embedded-stripe-success">
              <h2 className="text-xl font-bold text-[var(--mhb-status-complete-text)]">Payment setup complete</h2>
              <p className="mt-2 text-sm text-[var(--mhb-status-complete-text)]">Charges and payouts are enabled, and no current requirements are due.</p>
              <button type="button" onClick={() => navigate("/app/dashboard")} className="mt-4 min-h-11 rounded-xl bg-[var(--mhb-interactive-primary)] px-4 text-sm font-bold text-[var(--mhb-text-inverse)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Go to dashboard</button>
            </section>
          ) : null}
        </main>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 shadow-[var(--mhb-shadow-card)]" data-testid="stripe-account-status">
            <h2 className="font-bold text-[var(--mhb-text-primary)]">Payment account status</h2>
            <ul className="mt-3 space-y-2">
              <StatusItem label="Payment account created" complete={Boolean(status?.linked || accountId)} />
              <StatusItem label={status?.details_submitted ? "Details submitted" : "Stripe setup incomplete"} complete={Boolean(status?.details_submitted)} />
              <StatusItem label="Charges enabled" complete={Boolean(status?.charges_enabled)} />
              <StatusItem label="Payouts enabled" complete={Boolean(status?.payouts_enabled)} />
              {requirementsDue ? <StatusItem label="Requirements due" complete={false} detail={`${requirementsDue} item${requirementsDue === 1 ? "" : "s"} need attention`} /> : null}
            </ul>
            {accountId ? (
              <details className="mt-4 border-t border-[var(--mhb-border-divider)] pt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-[var(--mhb-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Technical details</summary>
                <p className="mt-2 break-words text-xs text-[var(--mhb-text-muted)]">Payment account reference: {maskAccountId(accountId)}</p>
              </details>
            ) : null}
          </section>
          <StripeGuidanceSidebar step={currentStripeStep} entityType={entityType} />
        </aside>
      </div>

      {showHostedConfirmation ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--mhb-surface-overlay)] p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHostedConfirmation(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="stripe-hosted-confirm-title" className="w-full max-w-lg rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-5 text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card-elevated)]" data-testid="embedded-stripe-hosted-confirmation">
            <h2 id="stripe-hosted-confirm-title" className="text-lg font-bold">Continue securely on Stripe?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--mhb-text-secondary)]">You’ll temporarily leave MyHomeBro to complete setup securely on Stripe. You’ll return here afterward.</p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowHostedConfirmation(false)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">Stay in MyHomeBro</button>
              <button type="button" onClick={launchHosted} disabled={hostedRequestRef.current} data-testid="embedded-stripe-hosted-confirm" className="min-h-11 rounded-xl bg-[var(--mhb-interactive-primary)] px-4 text-sm font-bold text-[var(--mhb-text-inverse)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--mhb-interactive-disabled-bg)] disabled:text-[var(--mhb-interactive-disabled-text)]">Continue to Stripe</button>
            </div>
          </section>
        </div>
      ) : null}
    </ContractorPageSurface>
  );
}

export { PHASE, isSecureStripeUrl, maskAccountId, safeSupportReference };
