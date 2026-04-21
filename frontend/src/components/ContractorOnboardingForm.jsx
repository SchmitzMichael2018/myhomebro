import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import {
  normalizeProjectFamilyContext,
  useWorkspaceProjectFamilyContext,
} from "../lib/projectFamilyContext.js";

const EMPTY_SETUP = {
  work_description: "",
  project_family: { key: "", label: "" },
  project_families: [],
  project_style: {
    workflow_style: "",
    materials_behavior: "",
    project_family_cue: "",
  },
  milestone_tendencies: [],
  pricing_baseline: {
    low: "",
    high: "",
    center: "",
    duration_low_days: 0,
    duration_high_days: 0,
    duration_days: 0,
    milestone_count: 0,
    confidence_level: "",
    confidence_reasoning: "",
  },
  agreement_defaults: {},
  clarification_questions: [],
  clarification_answers: {},
  recommended_setup: {},
  suggested_plan: {},
  source: "server",
  summary: "Tell us what kind of work you do and we will build your setup for you.",
  completed_at: null,
};

function safeText(value) {
  return value == null ? "" : String(value).trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractProjectFamily(value) {
  const next = value && typeof value === "object" ? value : {};
  const familyFromTopLevel = normalizeProjectFamilyContext(next.project_family || next);
  if (familyFromTopLevel.project_family_key) {
    return familyFromTopLevel;
  }

  const agreementDefaults = normalizeProjectFamilyContext(next.agreement_defaults || {});
  if (agreementDefaults.project_family_key) {
    return agreementDefaults;
  }

  const firstFamily = safeArray(next.project_families)[0];
  return normalizeProjectFamilyContext(firstFamily || {});
}

function normalizeSetup(value) {
  const next = value && typeof value === "object" ? value : {};
  const projectFamily = extractProjectFamily(next);
  return {
    ...EMPTY_SETUP,
    ...next,
    project_family: projectFamily,
    project_families: safeArray(next.project_families).length
      ? safeArray(next.project_families).map((family) => normalizeProjectFamilyContext(family))
      : projectFamily.key
      ? [projectFamily]
      : [],
    project_style: {
      ...EMPTY_SETUP.project_style,
      ...(next.project_style || {}),
    },
    pricing_baseline: {
      ...EMPTY_SETUP.pricing_baseline,
      ...(next.pricing_baseline || {}),
    },
    agreement_defaults: next.agreement_defaults || {},
    milestone_tendencies: safeArray(next.milestone_tendencies),
    clarification_questions: safeArray(next.clarification_questions),
    clarification_answers: next.clarification_answers || {},
    recommended_setup: next.recommended_setup || {},
    suggested_plan: next.suggested_plan || {},
    work_description: safeText(next.work_description),
    summary: safeText(next.summary) || EMPTY_SETUP.summary,
    source: safeText(next.source) || "server",
    completed_at: next.completed_at || null,
    last_saved_at: next.last_saved_at || "",
  };
}

function StepBadge({ step, current }) {
  const active = step === current;
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
      }`}
    >
      {step}
    </div>
  );
}

function SectionCard({ eyebrow, title, description, children, testId = "" }) {
  return (
    <section
      data-testid={testId || undefined}
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Pill({ children, tone = "slate" }) {
  const toneClasses = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
  };
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[tone] || toneClasses.slate}`}>
      {children}
    </span>
  );
}

function QuestionField({ question, value, onChange }) {
  const label = safeText(question?.label || question?.question || question?.title);
  const helpText = safeText(question?.help_text || question?.description);
  const options = safeArray(question?.options);
  const isTextarea = question?.input_type === "textarea" || question?.type === "text";
  const key = safeText(question?.key || question?.name || label);

  if (options.length) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {helpText ? <div className="mt-1 text-sm text-slate-600">{helpText}</div> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map((option, index) => {
            const optionLabel =
              typeof option === "string"
                ? option
                : safeText(option?.label || option?.value || option?.text || `Option ${index + 1}`);
            const optionValue =
              typeof option === "string"
                ? option
                : safeText(option?.value || option?.label || option?.text || optionLabel);
            const selected = safeText(value) === optionValue;
            return (
              <button
                type="button"
                key={`${key}-${optionValue || index}`}
                onClick={() => onChange(key, optionValue)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                  selected
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {optionLabel}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="block rounded-2xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-slate-900">{label}</div>
      {helpText ? <div className="mt-1 text-sm text-slate-600">{helpText}</div> : null}
      {isTextarea ? (
        <textarea
          value={safeText(value)}
          onChange={(e) => onChange(key, e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          placeholder="Add a quick note..."
        />
      ) : (
        <input
          value={safeText(value)}
          onChange={(e) => onChange(key, e.target.value)}
          className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          placeholder="Type your answer"
        />
      )}
    </label>
  );
}

export default function ContractorOnboardingForm() {
  const navigate = useNavigate();
  const { setProjectFamilyContext } = useWorkspaceProjectFamilyContext();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(EMPTY_SETUP);
  const [workDescription, setWorkDescription] = useState("");
  const [clarificationAnswers, setClarificationAnswers] = useState({});
  const [showAdjust, setShowAdjust] = useState(false);
  const [quickAdjustmentNotes, setQuickAdjustmentNotes] = useState("");
  const [finished, setFinished] = useState(false);

  const family = useMemo(() => normalizeProjectFamilyContext(setup.project_family), [setup.project_family]);
  const stepTitle = useMemo(() => {
    switch (step) {
      case 2:
        return "Tell us what kind of work you do";
      case 3:
        return "A few quick clarifications";
      case 4:
        return "Your Project Setup";
      case 5:
        return "Choose your next step";
      default:
        return "Let’s set up how you run your projects";
    }
  }, [step]);

  const loadSetup = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/projects/contractors/onboarding/setup/");
      const normalized = normalizeSetup(data);
      setSetup(normalized);
      setWorkDescription(normalized.work_description || "");
      setClarificationAnswers(normalized.clarification_answers || {});
      setFinished(Boolean(normalized.completed_at));
      if (normalized.completed_at) {
        setStep(5);
      } else if (normalized.work_description) {
        setStep(normalized.clarification_questions.length ? 3 : 4);
      } else {
        setStep(1);
      }
      const familyToStore = extractProjectFamily(normalized);
      if (familyToStore.project_family_key) {
        void setProjectFamilyContext(familyToStore, { syncServer: false });
      }
    } catch (err) {
      console.error("Failed to load contractor onboarding setup:", err);
      setSetup(EMPTY_SETUP);
      setError("We could not load your setup right now, but you can still continue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistSetup = async ({ nextWorkDescription, nextAnswers, completed = false, notes = "" }) => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch("/projects/contractors/onboarding/setup/", {
        work_description: nextWorkDescription ?? workDescription,
        clarification_answers: nextAnswers ?? clarificationAnswers,
        completed,
        quick_adjustment_notes: notes,
      });
      const normalized = normalizeSetup(data);
      setSetup(normalized);
      setWorkDescription(normalized.work_description || "");
      setClarificationAnswers(normalized.clarification_answers || {});
      setFinished(Boolean(completed || normalized.completed_at));
      const familyToStore = extractProjectFamily(normalized);
      if (familyToStore.project_family_key) {
        void setProjectFamilyContext(familyToStore, { syncServer: false });
      }
      return normalized;
    } catch (err) {
      console.error("Failed to save onboarding setup:", err);
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        "Unable to save your setup right now.";
      setError(String(detail));
      toast.error(String(detail));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const goToStep = (nextStep) => setStep((current) => Math.max(1, Math.min(5, nextStep || current)));

  const beginFlow = () => {
    setStep(2);
  };

  const continueFromDescription = async () => {
    const normalized = await persistSetup({ nextWorkDescription: workDescription });
    if (!normalized) return;
    setStep(normalized.clarification_questions.length ? 3 : 4);
  };

  const continueFromClarifications = async () => {
    const normalized = await persistSetup({
      nextWorkDescription: workDescription,
      nextAnswers: clarificationAnswers,
    });
    if (!normalized) return;
    setStep(4);
  };

  const completeSetup = async () => {
    const normalized = await persistSetup({
      nextWorkDescription: workDescription,
      nextAnswers: clarificationAnswers,
      completed: true,
      notes: quickAdjustmentNotes,
    });
    if (!normalized) return;
    setFinished(true);
    setStep(5);
  };

  const updateAnswer = (key, value) => {
    setClarificationAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const applyExample = (text) => {
    setWorkDescription(text);
    setStep(2);
  };

  const goToAgreementBuilder = () => {
    navigate("/app/agreements/new/wizard?step=1");
  };

  const goToDashboard = () => {
    navigate("/app/dashboard");
  };

  const projectFamilyPills = safeArray(setup.project_families);
  const milestoneRows = safeArray(setup.milestone_tendencies);
  const questions = safeArray(setup.clarification_questions);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="rounded-3xl border border-slate-200 bg-slate-950 px-6 py-6 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                Intelligent onboarding
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                Let&apos;s set up how you run your projects
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
                Tell us a bit about your work and we&apos;ll build your project setup for you.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 text-xs text-slate-300">
              <Pill tone="sky">3 to 5 minute setup</Pill>
              <Pill tone="emerald">Uses project intelligence</Pill>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Progress
            </div>
            <div className="mt-4 space-y-4">
              {[
                "Welcome",
                "Work description",
                "Clarifications",
                "Generated setup",
                "Finish",
              ].map((label, index) => (
                <div key={label} className="flex items-center gap-3">
                  <StepBadge step={index + 1} current={step} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{label}</div>
                    <div className="text-xs text-slate-500">
                      {index + 1 === 1
                        ? "Start here"
                        : index + 1 === 2
                        ? "Describe your work"
                        : index + 1 === 3
                        ? "Answer a few quick questions"
                        : index + 1 === 4
                        ? "Review the generated setup"
                        : "Pick where to go next"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current family
              </div>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {family.label || "General project review"}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {setup.project_style?.workflow_style || "We will infer this from your description."}
              </div>
            </div>
          </aside>

          <main className="space-y-6">
            {loading ? (
              <SectionCard
                eyebrow="Loading"
                title="Building your setup"
                description="We are checking your existing setup and preparing the first pass."
                testId="contractor-onboarding-loading"
              >
                <div className="animate-pulse rounded-2xl bg-slate-100 px-4 py-6 text-sm text-slate-500">
                  Loading your contractor setup...
                </div>
              </SectionCard>
            ) : null}

            {!loading && step === 1 ? (
              <SectionCard
                eyebrow={`Step 1 of 5`}
                title={stepTitle}
                description="You give us one sentence and we build your default setup."
                testId="contractor-onboarding-welcome"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => beginFlow()}
                    className="rounded-2xl bg-slate-950 px-5 py-4 text-left text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    onClick={() => applyExample("Kitchen remodels and cabinet installs")}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Example: Kitchen remodels and cabinet installs
                  </button>
                  <button
                    type="button"
                    onClick={() => applyExample("Roofing and repairs")}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Example: Roofing and repairs
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step >= 2 ? (
              <SectionCard
                eyebrow={`Step ${Math.min(step, 5)} of 5`}
                title={stepTitle}
                description="Keep it short. A sentence is enough."
                testId="contractor-onboarding-description"
              >
                <textarea
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  rows={5}
                  className="w-full rounded-3xl border border-slate-200 px-4 py-3 text-base focus:border-slate-400 focus:outline-none"
                  placeholder="What kind of work do you usually do?"
                />
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setWorkDescription("Kitchen remodels and cabinet installs")}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                  >
                    Kitchen remodels and cabinet installs
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkDescription("Roofing and repairs")}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                  >
                    Roofing and repairs
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkDescription("General handyman work")}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                  >
                    General handyman work
                  </button>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => goToStep(1)}
                    className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={continueFromDescription}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? "Building setup..." : "Continue"}
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step === 3 ? (
              <SectionCard
                eyebrow="Step 3 of 5"
                title="A few quick clarifications"
                description="These are optional, short, and based on your work type."
                testId="contractor-onboarding-clarifications"
              >
                <div className="space-y-4">
                  {questions.length ? (
                    questions.map((question, index) => (
                      <QuestionField
                        key={`${question?.key || index}`}
                        question={question}
                        value={clarificationAnswers[question?.key || question?.name || `q-${index}`]}
                        onChange={updateAnswer}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                      We did not need extra questions for this setup. You can continue to the generated plan.
                    </div>
                  )}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={continueFromClarifications}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? "Updating..." : "Build my setup"}
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step >= 4 ? (
              <SectionCard
                eyebrow="Step 4 of 5"
                title="Your Project Setup"
                description={setup.summary || "We generated a usable starting setup from your work type."}
                testId="contractor-onboarding-generated-setup"
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Work Profile
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {family.label || "General project review"}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {projectFamilyPills.length ? (
                        projectFamilyPills.map((item) => (
                          <Pill key={`${item.key || item.label}`} tone="sky">
                            {item.label || item.key}
                          </Pill>
                        ))
                      ) : (
                        <Pill tone="slate">General project review</Pill>
                      )}
                    </div>
                    <div className="mt-4 text-sm text-slate-600">
                      {setup.project_style?.project_family_cue ||
                        "We inferred the best-fit project family from your description."}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Project Style
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {setup.project_style?.workflow_style || "General project review"}
                    </div>
                    <div className="mt-3 text-sm text-slate-600">
                      {setup.project_style?.materials_behavior ||
                        "Materials behavior will stay flexible until you decide how you want to run projects."}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Suggested Plan Structure
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {setup.pricing_baseline?.milestone_count || milestoneRows.length || 3} milestones
                    </div>
                    <div className="mt-3 space-y-2">
                      {milestoneRows.length ? (
                        milestoneRows.map((row, index) => (
                          <div key={`${row.title || index}`} className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">{row.title || `Milestone ${index + 1}`}</span>
                            {row.note ? <span className="text-slate-500"> - {row.note}</span> : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-600">
                          We will use a safe default milestone plan if the system cannot narrow it further.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Pricing + Duration Baseline
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {setup.pricing_baseline?.low && setup.pricing_baseline?.high
                        ? `$${Number(setup.pricing_baseline.low).toLocaleString()} - $${Number(
                            setup.pricing_baseline.high
                          ).toLocaleString()}`
                        : "Safe baseline pricing will be shown here"}
                    </div>
                    <div className="mt-3 text-sm text-slate-600">
                      {setup.pricing_baseline?.duration_low_days || setup.pricing_baseline?.duration_high_days
                        ? `${setup.pricing_baseline.duration_low_days || 1} - ${
                            setup.pricing_baseline.duration_high_days || setup.pricing_baseline.duration_days || 1
                          } days`
                        : "Duration baseline will appear once the system infers the job type."}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Pill tone="emerald">
                        {setup.pricing_baseline?.confidence_level || "medium"} confidence
                      </Pill>
                      <Pill tone="slate">
                        {setup.pricing_baseline?.center ? `Center $${Number(setup.pricing_baseline.center).toLocaleString()}` : "Conservative range"}
                      </Pill>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Agreement Defaults
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[
                      ["Project type", setup.agreement_defaults?.project_type || "General project review"],
                      ["Project subtype", setup.agreement_defaults?.project_subtype || "General project review"],
                      ["Workflow", setup.agreement_defaults?.suggested_workflow || "General project review"],
                      ["Template", setup.agreement_defaults?.suggested_template_label || "No template selected"],
                      ["Payment mode", setup.agreement_defaults?.payment_mode || "escrow"],
                      ["Payment structure", setup.agreement_defaults?.payment_structure || "progress"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {label}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {!showAdjust ? (
                    <button
                      type="button"
                      onClick={() => setShowAdjust(true)}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Adjust
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={completeSetup}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? "Saving setup..." : "Looks good"}
                  </button>
                </div>

                {showAdjust ? (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-900">Quick adjustment</div>
                    <p className="mt-1 text-sm text-slate-600">
                      Make a small wording change and rebuild the setup.
                    </p>
                    <textarea
                      value={quickAdjustmentNotes || workDescription}
                      onChange={(e) => {
                        setQuickAdjustmentNotes(e.target.value);
                        setWorkDescription(e.target.value);
                      }}
                      rows={3}
                      className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                    />
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdjust(false);
                          setQuickAdjustmentNotes("");
                        }}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const normalized = await persistSetup({
                            nextWorkDescription: workDescription,
                            nextAnswers: clarificationAnswers,
                            notes: quickAdjustmentNotes,
                          });
                          if (!normalized) return;
                          setShowAdjust(false);
                        }}
                        className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>
                ) : null}
              </SectionCard>
            ) : null}

            {!loading && step === 5 ? (
              <SectionCard
                eyebrow="Step 5 of 5"
                title="Your setup is ready"
                description="You can jump into the builder or your dashboard with the same project-family context."
                testId="contractor-onboarding-finish"
              >
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={goToAgreementBuilder}
                    className="min-h-12 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Open Agreement Builder
                  </button>
                  <button
                    type="button"
                    onClick={goToDashboard}
                    className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Go to Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/onboarding")}
                    className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Connect Stripe later
                  </button>
                </div>
                <div className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  {finished
                    ? "Your setup is saved and ready to use across dashboard, agreement builder, templates, and AI context."
                    : "Your setup is ready. Choose where you want to go next."}
                </div>
              </SectionCard>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
