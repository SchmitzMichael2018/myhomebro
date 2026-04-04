import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api";
import { trackOnboardingEvent } from "../../lib/onboardingAnalytics.js";
import StripeOnboardingButton from "../StripeOnboardingButton.jsx";

const TRADE_OPTIONS = [
  "HVAC",
  "Landscaping",
  "Pest Control",
  "Pool Service",
  "Electrical",
  "Plumbing",
  "Painting",
  "Roofing",
  "Inspection",
  "Lawn Care",
];

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
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function PrimaryCard({ eyebrow, title, description, children, testId = "" }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={testId || undefined}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function OnboardingStripeStep({
  stepNumber,
  stepTotal,
  stripeReady,
  statusError,
  onBack,
  onSkip,
  saving,
}) {
  return (
    <PrimaryCard
      eyebrow={`Step ${Math.min(stepNumber, stepTotal)} of ${stepTotal}`}
      title={stripeReady ? "You're ready to get paid" : "Set up payments to get paid faster"}
      description={
        stripeReady
          ? "Stripe is connected. You can return here any time to manage payout settings."
          : "You can keep exploring, but payment collection and payouts require a connected Stripe account."
      }
      testId="contractor-onboarding-stripe"
    >
      {statusError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {statusError}
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Back
        </button>
        <StripeOnboardingButton
          dataTestId="contractor-onboarding-connect-stripe"
          className="min-h-12 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Connect Stripe
        </StripeOnboardingButton>
        {!stripeReady ? (
          <button
            type="button"
            data-testid="contractor-onboarding-skip-stripe"
            onClick={onSkip}
            disabled={saving}
            className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [onboarding, setOnboarding] = useState(null);
  const [meData, setMeData] = useState(null);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [localStep, setLocalStep] = useState(null);
  const [form, setForm] = useState({
    business_name: "",
    city: "",
    state: "",
    zip: "",
    service_radius_miles: 25,
    skills: [],
  });

  async function loadAll() {
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
      setMeData(me);
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
  }

  useEffect(() => {
    loadAll();
  }, []);

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

  function toggleSkill(skill) {
    setForm((current) => {
      const has = current.skills.includes(skill);
      return {
        ...current,
        skills: has
          ? current.skills.filter((item) => item !== skill)
          : [...current.skills, skill],
      };
    });
  }

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

  const rightRailCards = useMemo(() => {
    return [
      {
        title: "Activation Snapshot",
        body: (
          <div className="space-y-3 text-sm text-slate-700">
            <div>
              <div className="font-semibold text-slate-900">Business</div>
              <div>{meData?.business_name || form.business_name || "Not set yet"}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Service area</div>
              <div>{[form.city || meData?.city, form.state || meData?.state].filter(Boolean).join(", ") || "Not set yet"}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Trades</div>
              <div>{(form.skills || []).join(", ") || "Pick at least one trade"}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Last step reached</div>
              <div>{onboarding?.activation?.last_step_reached || currentStep}</div>
            </div>
          </div>
        ),
      },
      {
        title: "What comes next",
        body: (
          <ul className="space-y-2 text-sm text-slate-600">
            <li>Pick trades so templates, pricing, and compliance guidance stay relevant.</li>
            <li>Set your home service area so recommendations stay local and accurate.</li>
            <li>Connect Stripe when you are ready to receive payments and payouts.</li>
          </ul>
        ),
      },
    ];
  }, [currentStep, form.business_name, form.city, form.skills, form.state, meData, onboarding]);

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
            className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
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
            className="min-h-12 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
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
          eyebrow={`Step ${stepNumber} of ${stepTotal}`}
          title="Pick your trades"
          description="Keep this quick. Tapping one or two trades is enough to personalize your templates, estimates, and compliance guidance."
          testId="contractor-onboarding-trades"
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {TRADE_OPTIONS.map((skill) => {
              const active = form.skills.includes(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkill(skill)}
                  className={`min-h-12 rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {skill}
                </button>
              );
            })}
          </div>
          <div className="mt-4">
            <label className="block text-sm font-semibold text-slate-900">Business name</label>
            <input
              type="text"
              value={form.business_name}
              onChange={(e) => setForm((current) => ({ ...current, business_name: e.target.value }))}
              data-testid="contractor-onboarding-business-name"
              className="mt-1 h-12 w-full rounded-2xl border border-slate-200 px-3 text-sm"
              placeholder="MyHomeBro Services"
            />
          </div>
          {renderStepActions({
            onContinue: handleContinueTrades,
            continueDisabled: !form.skills.length,
            continueTestId: "contractor-onboarding-save-basics",
          })}
        </PrimaryCard>
      );
    }

    if (currentStep === "region") {
      return (
        <PrimaryCard
          eyebrow={`Step ${stepNumber} of ${stepTotal}`}
          title="Set your service area"
          description="This keeps template and pricing suggestions relevant without asking for a full profile up front."
          testId="contractor-onboarding-region"
        >
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))}
                data-testid="contractor-onboarding-city"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 px-3 text-sm"
                placeholder="San Antonio"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-900">State</label>
              <select
                value={form.state}
                onChange={(e) => setForm((current) => ({ ...current, state: e.target.value }))}
                data-testid="contractor-onboarding-state"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"
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
              <label className="block text-sm font-semibold text-slate-900">ZIP</label>
              <input
                type="text"
                value={form.zip}
                onChange={(e) => setForm((current) => ({ ...current, zip: e.target.value }))}
                data-testid="contractor-onboarding-zip"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 px-3 text-sm"
                placeholder="78205"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-900">Service Range (miles)</label>
              <select
                value={String(form.service_radius_miles || 25)}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    service_radius_miles: Number(e.target.value || 25),
                  }))
                }
                data-testid="contractor-onboarding-service-radius"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"
              >
                {SERVICE_RADIUS_OPTIONS.map((miles) => (
                  <option key={miles} value={miles}>
                    {miles}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-600">
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

    return (
      <OnboardingStripeStep
        stepNumber={stepNumber}
        stepTotal={stepTotal}
        stripeReady={stripeReady}
        statusError={statusError}
        onBack={() => handleBack("region")}
        onSkip={handleSkipStripe}
        saving={saving}
      />
    );
  }

  return (
    <div className="mhb-gradient-bg min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="contractor-onboarding-page">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Contractor Onboarding
              </div>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                Reach first value before payments setup
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                The goal is simple: get your first project moving quickly, then connect payments when the timing makes sense.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              <StripeStatusBadge stripeStatus={stripeStatus} />
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Step {stepNumber} of {stepTotal}
              </span>
            </div>
          </div>

          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${Math.max(10, Math.min(100, (stepNumber / stepTotal) * 100))}%` }}
            />
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 text-sm text-slate-600">Loading onboarding...</div>
          ) : (
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
              <div className="space-y-5">
                {renderCurrentStep()}

                {onboarding?.show_soft_stripe_prompt && !stripeReady ? (
                  <div
                    className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
                    data-testid="contractor-onboarding-soft-stripe-prompt"
                  >
                    <div className="text-sm font-semibold text-amber-900">
                      Set up payments now to get paid faster
                    </div>
                    <div className="mt-2 text-sm text-amber-800">
                      You are ready to explore the app. Payments can wait, but they will require Stripe before you send money-related workflows.
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-5">
                {rightRailCards.map((card) => (
                  <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-sm font-semibold text-slate-900">{card.title}</div>
                    <div className="mt-3">{card.body}</div>
                  </div>
                ))}

                <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="contractor-onboarding-summary">
                  <div className="text-sm font-semibold text-slate-900">Progress so far</div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trades selected</div>
                      <div className="mt-1 font-semibold text-slate-900">{Number(onboarding?.trade_count || 0)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current step</div>
                      <div className="mt-1 font-semibold text-slate-900">Step {stepNumber} of {stepTotal}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
