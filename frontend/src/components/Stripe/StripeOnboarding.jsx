import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../../api";
import { trackOnboardingEvent } from "../../lib/onboardingAnalytics.js";
import StripeOnboardingButton from "../StripeOnboardingButton.jsx";
import TradeMultiSelect from "../trades/TradeMultiSelect.jsx";
import {
  STRIPE_GUIDANCE,
  writeEntityTypeToSession,
} from "../../lib/stripeGuidanceContent.js";

const STATE_OPTIONS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
];

const SERVICE_RADIUS_OPTIONS = [10, 25, 50, 100];

function StripeStatusBadge({ stripeStatus }) {
  const connected = Boolean(stripeStatus?.connected);
  const label = connected
    ? "Ready to receive payouts"
    : stripeStatus?.onboarding_status === "not_started"
    ? "Payments not connected"
    : "Stripe onboarding incomplete";
  const tone = connected
    ? "border-[var(--mhb-status-complete-border)] bg-[var(--mhb-status-complete-bg)] text-[var(--mhb-status-complete-text)]"
    : "border-[var(--mhb-status-pending-border)] bg-[var(--mhb-status-pending-bg)] text-[var(--mhb-status-pending-text)]";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function PrimaryCard({ eyebrow, title, description, children, testId = "" }) {
  return (
    <section className="rounded-3xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-5 shadow-[var(--mhb-shadow-card)] sm:p-6" data-testid={testId || undefined}>
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--mhb-text-muted)]">
          {eyebrow}
        </div>
      ) : null}
      <h2 className={`${eyebrow ? "mt-2" : ""} text-2xl font-bold text-[var(--mhb-text-primary)]`}>{title}</h2>
      <p className="mt-2 text-base leading-6 text-[var(--mhb-text-secondary)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ChecklistItem({ label, value, complete }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${
          complete
            ? "bg-emerald-600 text-white"
            : "border border-[var(--mhb-border-strong)] text-[var(--mhb-text-muted)]"
        }`}
      >
        {complete ? "✓" : "—"}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--mhb-text-primary)]">{label}</span>
        <span className="mt-0.5 block break-words text-sm text-[var(--mhb-text-secondary)]">
          {value}
        </span>
        <span className="sr-only">{complete ? "Complete" : "Incomplete"}</span>
      </span>
    </li>
  );
}

function OnboardingStripeStep({
  stripeReady,
  statusError,
  onBack,
  onSkip,
  saving,
}) {
  return (
    <PrimaryCard
      title={stripeReady ? "You're ready to get paid" : "Set up payments to get paid faster"}
      description={
        stripeReady
          ? "Stripe is connected. You can return here any time to manage payout settings."
          : "You can keep exploring, but payment collection and payouts require a connected Stripe account."
      }
      testId="contractor-onboarding-stripe"
    >
      {statusError ? (
        <div className="rounded-xl border border-[var(--mhb-status-blocked-border)] bg-[var(--mhb-status-blocked-bg)] px-3 py-2 text-sm text-[var(--mhb-status-blocked-text)]">
          {statusError}
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="min-h-12 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-primary)] transition hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] disabled:cursor-not-allowed disabled:text-[var(--mhb-interactive-disabled-text)]"
        >
          Back
        </button>
        <StripeOnboardingButton
          dataTestId="contractor-onboarding-connect-stripe"
          className="min-h-12 rounded-2xl bg-[var(--mhb-interactive-primary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-inverse)] transition hover:bg-[var(--mhb-interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--mhb-interactive-disabled-bg)] disabled:text-[var(--mhb-interactive-disabled-text)]"
        >
          Connect Stripe
        </StripeOnboardingButton>
        {!stripeReady ? (
          <button
            type="button"
            data-testid="contractor-onboarding-skip-stripe"
            onClick={onSkip}
            disabled={saving}
            className="min-h-12 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-primary)] transition hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] disabled:cursor-not-allowed disabled:text-[var(--mhb-interactive-disabled-text)]"
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </PrimaryCard>
  );
}

export default function StripeOnboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [onboarding, setOnboarding] = useState(null);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [localStep, setLocalStep] = useState(null);
  const [entityType, setEntityType] = useState(null);
  const [entityTypeConfirmed, setEntityTypeConfirmed] = useState(false);
  const [form, setForm] = useState({
    business_name: "",
    city: "",
    state: "",
    zip: "",
    service_radius_miles: 25,
    skills: [],
    custom_services: [],
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatusError("");
    try {
      const [meRes, onboardingRes, stripeRes] = await Promise.all([
        api.get("/projects/contractors/me/"),
        api.get("/projects/contractors/onboarding/"),
        api.get("/payments/onboarding/status/"),
      ]);
      const me = meRes?.data || {};
      const onboardingData = onboardingRes?.data || {};
      const stripe = stripeRes?.data || {};
      setOnboarding(onboardingData);
      setStripeStatus(stripe);
      setLocalStep((current) => current || onboardingData?.step || "welcome");
      setForm({
        business_name: me.business_name || "",
        city: me.city || "",
        state: me.state || "",
        zip: me.zip || "",
        service_radius_miles: Number(me.service_radius_miles || onboardingData.service_radius_miles || 25),
        skills: Array.isArray(me.skills) ? me.skills : [],
        custom_services: Array.isArray(me.custom_services) ? me.custom_services : [],
      });

      if (onboardingData?.show_soft_stripe_prompt) {
        trackOnboardingEvent({
          eventType: "stripe_prompt_shown",
          step: "stripe",
          context: { source: "onboarding_page" },
          once: true,
        });
      }
    } catch (err) {
      console.error(err);
      setError("Unable to load onboarding right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [location.key, loadAll]);

  const currentStep = localStep || onboarding?.step || "welcome";
  const stepNumberMap = {
    welcome: 1,
    region: 2,
    stripe: 3,
    complete: 3,
  };
  const stepNumber = stepNumberMap[currentStep] || Number(onboarding?.step_number || 1);
  const stepTotal = 3;
  const stripeReady = Boolean(onboarding?.stripe_ready || stripeStatus?.connected);

  async function patchOnboarding(payload) {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch("/projects/contractors/onboarding/", payload);
      setOnboarding(data);
      await loadAll();
      return data;
    } catch (err) {
      console.error(err);
      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          "Unable to save onboarding details."
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleContinueTrades() {
    setLocalStep("region");
    await patchOnboarding({
      business_name: form.business_name,
      skills: form.skills,
      custom_services: form.custom_services,
      contractor_onboarding_step: "region",
    });
  }

  async function handleContinueRegion() {
    setLocalStep("stripe");
    await patchOnboarding({
      business_name: form.business_name,
      city: form.city,
      state: form.state,
      zip: form.zip,
      service_radius_miles: form.service_radius_miles,
      skills: form.skills,
      custom_services: form.custom_services,
      contractor_onboarding_step: "stripe",
    });
  }

  function handleBack(targetStep) {
    setStatusError("");
    setLocalStep(targetStep);
  }

  async function dismissStripePrompt() {
    try {
      const { data } = await api.post("/projects/contractors/onboarding/dismiss-stripe-prompt/");
      setOnboarding(data);
    } catch (err) {
      console.error(err);
      setStatusError("Unable to dismiss the Stripe reminder right now.");
    }
  }

  async function handleSkipStripe() {
    setLocalStep("");
    await dismissStripePrompt();
    navigate("/app/dashboard");
  }

  function renderStepActions({
    backLabel = "Back",
    onBack,
    continueLabel = "Continue",
    onContinue,
    continueDisabled = false,
    continueTestId,
    children = null,
  }) {
    return (
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={saving}
            className="min-h-12 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-primary)] transition hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] disabled:cursor-not-allowed disabled:text-[var(--mhb-interactive-disabled-text)]"
          >
            {backLabel}
          </button>
        ) : null}
        {onContinue ? (
          <button
            type="button"
            data-testid={continueTestId}
            onClick={onContinue}
            disabled={saving || continueDisabled}
            aria-describedby={continueDisabled ? "onboarding-services-requirement" : undefined}
            className="min-h-14 w-full rounded-2xl bg-[var(--mhb-interactive-primary)] px-7 py-3 text-base font-bold text-[var(--mhb-text-inverse)] shadow-[var(--mhb-shadow-interactive)] transition hover:bg-[var(--mhb-interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mhb-surface-card)] disabled:cursor-not-allowed disabled:bg-[var(--mhb-interactive-disabled-bg)] disabled:text-[var(--mhb-interactive-disabled-text)] disabled:shadow-none sm:ml-auto sm:w-auto"
          >
            {saving ? "Saving..." : continueLabel}
          </button>
        ) : null}
        {children}
      </div>
    );
  }

  function renderCurrentStep() {
    if (currentStep === "welcome") {
      return (
        <PrimaryCard
          title="Business details"
          description="Add the essentials customers will use to understand your business."
          testId="contractor-onboarding-trades"
        >
          <div className="mb-6">
            <label htmlFor="mhb-stripeonboarding-346" className="block text-sm font-semibold text-[var(--mhb-text-primary)]">Business name</label>
            <input id="mhb-stripeonboarding-346"
              type="text"
              value={form.business_name}
              onChange={(e) => setForm((current) => ({ ...current, business_name: e.target.value }))}
              data-testid="contractor-onboarding-business-name"
              className="mt-2 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-4 text-base text-[var(--mhb-text-primary)] placeholder:text-[var(--mhb-text-muted)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
              placeholder="MyHomeBro Services"
            />
          </div>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-[var(--mhb-text-primary)]">Services you offer</h3>
            <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
              Choose one or more services. You can update these later from your profile.
            </p>
          </div>
          <TradeMultiSelect
            value={form.skills}
            onChange={(nextSkills) => setForm((current) => ({ ...current, skills: nextSkills }))}
            customServices={form.custom_services}
            onCustomServicesChange={(customServices) => setForm((current) => ({ ...current, custom_services: customServices }))}
            allowCustomServices
            label="Find another service"
            helpText=""
            popularLabel="Popular services"
            selectedLabel="Selected services"
            searchPlaceholder="Search all services..."
            testIdPrefix="contractor-onboarding-trade"
            selectedFirst
            hideSelectedFromResults
            popularLimit={8}
          />
          {!form.skills.length && !form.custom_services.length ? (
            <p className="mt-5 text-sm font-medium text-[var(--mhb-text-secondary)]" id="onboarding-services-requirement">
              Select at least one service to continue.
            </p>
          ) : null}
          {renderStepActions({
            onContinue: handleContinueTrades,
            continueDisabled: !form.skills.length && !form.custom_services.length,
            continueTestId: "contractor-onboarding-save-basics",
          })}
        </PrimaryCard>
      );
    }

    if (currentStep === "region") {
      return (
        <PrimaryCard
          title="Set your service area"
          description="This keeps template and pricing suggestions relevant without asking for a full profile up front."
          testId="contractor-onboarding-region"
        >
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="mhb-stripeonboarding-375" className="block text-sm font-semibold text-[var(--mhb-text-primary)]">City</label>
              <input id="mhb-stripeonboarding-375"
                type="text"
                value={form.city}
                onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))}
                data-testid="contractor-onboarding-city"
                className="mt-1 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 text-sm text-[var(--mhb-text-primary)] placeholder:text-[var(--mhb-text-muted)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:ring-[var(--mhb-border-focus)]"
                placeholder="San Antonio"
              />
            </div>
            <div>
              <label htmlFor="mhb-stripeonboarding-386" className="block text-sm font-semibold text-[var(--mhb-text-primary)]">State</label>
              <select id="mhb-stripeonboarding-386"
                value={form.state}
                onChange={(e) => setForm((current) => ({ ...current, state: e.target.value }))}
                data-testid="contractor-onboarding-state"
                className="mt-1 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 text-sm text-[var(--mhb-text-primary)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:ring-[var(--mhb-border-focus)]"
              >
                <option value="">Select state...</option>
                {STATE_OPTIONS.map((stateCode) => (
                  <option key={stateCode} value={stateCode}>
                    {stateCode}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mhb-stripeonboarding-402" className="block text-sm font-semibold text-[var(--mhb-text-primary)]">ZIP</label>
              <input id="mhb-stripeonboarding-402"
                type="text"
                value={form.zip}
                onChange={(e) => setForm((current) => ({ ...current, zip: e.target.value }))}
                data-testid="contractor-onboarding-zip"
                className="mt-1 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 text-sm text-[var(--mhb-text-primary)] placeholder:text-[var(--mhb-text-muted)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:ring-[var(--mhb-border-focus)]"
                placeholder="78205"
              />
            </div>
            <div>
              <label htmlFor="mhb-stripeonboarding-413" className="block text-sm font-semibold text-[var(--mhb-text-primary)]">Service Range (miles)</label>
              <select id="mhb-stripeonboarding-413"
                value={String(form.service_radius_miles || 25)}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    service_radius_miles: Number(e.target.value || 25),
                  }))
                }
                data-testid="contractor-onboarding-service-radius"
                className="mt-1 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 text-sm text-[var(--mhb-text-primary)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:ring-[var(--mhb-border-focus)]"
              >
                {SERVICE_RADIUS_OPTIONS.map((miles) => (
                  <option key={miles} value={miles}>
                    {miles}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 text-sm text-[var(--mhb-text-secondary)]">
            Your ZIP is used as the center of your service area.
          </div>
          {renderStepActions({
            onBack: () => handleBack("welcome"),
            onContinue: handleContinueRegion,
            continueDisabled: !form.state,
          })}
        </PrimaryCard>
      );
    }

    // Entity type pre-conversation: show before the Connect button if not yet confirmed.
    if (!entityTypeConfirmed && !stripeReady) {
      return (
        <PrimaryCard
          title="One quick question first"
          description={STRIPE_GUIDANCE.intro.default}
          testId="contractor-onboarding-entity-type"
        >
          <div className="mt-4 text-sm font-semibold text-[var(--mhb-text-primary)]">
            How is your business set up?
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {[
              { key: "sole_proprietor", label: "Sole proprietor" },
              { key: "llc", label: "LLC" },
              { key: "corporation", label: "Corporation" },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                data-testid={`contractor-onboarding-entity-${key}`}
                onClick={() => {
                  setEntityType(key);
                  writeEntityTypeToSession(key);
                  setEntityTypeConfirmed(true);
                }}
                className={`rounded-2xl border px-5 py-3 text-sm font-semibold transition ${
                  entityType === key
                    ? "border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)] text-[var(--mhb-text-primary)] ring-1 ring-[var(--mhb-border-selected)]"
                    : "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] text-[var(--mhb-text-secondary)] hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-surface-interactive-hover)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {entityType ? (
            <div className="mt-4 rounded-2xl border border-[var(--mhb-status-recommended-border)] bg-[var(--mhb-status-recommended-bg)] px-4 py-3 text-sm text-[var(--mhb-status-recommended-text)]">
              {STRIPE_GUIDANCE.entity[entityType]}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleBack("region")}
              className="min-h-12 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-primary)] hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]"
            >
              Back
            </button>
            <button
              type="button"
              data-testid="contractor-onboarding-entity-skip"
              onClick={() => {
                writeEntityTypeToSession(null);
                setEntityTypeConfirmed(true);
              }}
              className="min-h-12 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-5 py-3 text-sm font-semibold text-[var(--mhb-text-secondary)] hover:bg-[var(--mhb-surface-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]"
            >
              Skip this step
            </button>
          </div>
        </PrimaryCard>
      );
    }

    return (
      <OnboardingStripeStep
        stripeReady={stripeReady}
        statusError={statusError}
        onBack={() => {
          setEntityTypeConfirmed(false);
          setEntityType(null);
          writeEntityTypeToSession(null);
        }}
        onSkip={handleSkipStripe}
        saving={saving}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mhb-surface-workspace)] px-4 py-6 text-[var(--mhb-text-primary)] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-workspace-elevated)] p-5 shadow-[var(--mhb-shadow-card-elevated)] sm:p-7" data-testid="contractor-onboarding-page">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--mhb-text-muted)]">
                Contractor setup
              </div>
              <h1 className="mt-2 text-3xl font-bold text-[var(--mhb-text-primary)]">
                Set up your contractor profile
              </h1>
              <p className="mt-2 max-w-2xl text-base text-[var(--mhb-text-secondary)]">
                Add your business details and services now. You can connect payments later.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              <StripeStatusBadge stripeStatus={stripeStatus} />
              <span className="text-sm font-semibold text-[var(--mhb-text-secondary)]" data-testid="contractor-onboarding-step-indicator">
                Step {stepNumber} of {stepTotal}
              </span>
            </div>
          </div>

          <div
            className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[var(--mhb-surface-inset)]"
            role="progressbar"
            aria-label={`Contractor setup progress: step ${stepNumber} of ${stepTotal}`}
            aria-valuemin="1"
            aria-valuemax={stepTotal}
            aria-valuenow={stepNumber}
          >
            <div
              className="h-full rounded-full bg-[var(--mhb-border-selected)] transition-all"
              style={{ width: `${Math.max(10, Math.min(100, (stepNumber / stepTotal) * 100))}%` }}
            />
          </div>

          {error && onboarding ? (
            <div className="mt-4 rounded-xl border border-[var(--mhb-status-blocked-border)] bg-[var(--mhb-status-blocked-bg)] px-4 py-3 text-sm text-[var(--mhb-status-blocked-text)]">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 text-sm text-[var(--mhb-text-secondary)]">Loading onboarding...</div>
          ) : error && !onboarding ? (
            <div className="mt-6 rounded-2xl border border-[var(--mhb-status-blocked-border)] bg-[var(--mhb-status-blocked-bg)] p-5" role="alert">
              <h2 className="font-bold text-[var(--mhb-status-blocked-text)]">We couldn’t load your setup progress</h2>
              <p className="mt-1 text-sm text-[var(--mhb-status-blocked-text)]">
                No progress was changed. Retry when your connection is available.
              </p>
              <button
                type="button"
                onClick={loadAll}
                className="mt-4 min-h-11 rounded-xl bg-[var(--mhb-interactive-danger-bg)] px-5 text-sm font-bold text-[var(--mhb-interactive-danger-text)] hover:bg-[var(--mhb-interactive-danger-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.7fr)]">
              <div className="space-y-5">
                {renderCurrentStep()}

                {onboarding?.show_soft_stripe_prompt && !stripeReady ? (
                  <div
                    className="rounded-2xl border border-[var(--mhb-status-pending-border)] bg-[var(--mhb-status-pending-bg)] p-5"
                    data-testid="contractor-onboarding-soft-stripe-prompt"
                  >
                    <div className="text-sm font-semibold text-[var(--mhb-status-pending-text)]">
                      Set up payments now to get paid faster
                    </div>
                    <div className="mt-2 text-sm text-[var(--mhb-status-pending-text)]">
                      You are ready to explore the app. Payments can wait, but they will require Stripe before you send money-related workflows.
                    </div>
                  </div>
                ) : null}
              </div>

              <aside
                className="h-fit rounded-3xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-5 shadow-[var(--mhb-shadow-card)]"
                data-testid="contractor-onboarding-summary"
                aria-labelledby="onboarding-checklist-title"
              >
                <h2 id="onboarding-checklist-title" className="text-lg font-bold text-[var(--mhb-text-primary)]">
                  Setup checklist
                </h2>
                <ul className="mt-4 space-y-3">
                  <ChecklistItem
                    label="Business name"
                    value={form.business_name.trim() || "Not set yet"}
                    complete={Boolean(form.business_name.trim())}
                  />
                  <ChecklistItem
                    label="Services"
                    value={`${form.skills.length} selected`}
                    complete={form.skills.length > 0}
                  />
                  <ChecklistItem
                    label="Service area"
                    value={[form.city, form.state].filter(Boolean).join(", ") || "Not set yet"}
                    complete={Boolean(form.state)}
                  />
                </ul>
                <p className="mt-5 border-t border-[var(--mhb-border-divider)] pt-4 text-sm leading-6 text-[var(--mhb-text-secondary)]">
                  Payments can be connected later when you are ready to receive customer funds.
                </p>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
