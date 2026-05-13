import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import {
  normalizeProjectFamilyContext,
  useWorkspaceProjectFamilyContext,
} from "../lib/projectFamilyContext.js";
import { writeSessionAssistantHandoff as writeFirstProjectAssistHandoff } from "../lib/assistantHandoff.js";

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
  business_details: {
    service_area_type: "both",
    service_radius_miles: 25,
    emergency_services: false,
    licensed: false,
    insured: false,
    accepts_diy_assistance: false,
    accepts_consultation_only: false,
    accepts_inspection_only: false,
  },
  recommended_setup: {},
  suggested_plan: {},
  source: "server",
  summary: "Tell us what kind of work you do and we will build your setup for you.",
  completed_at: null,
};

const ONBOARDING_STEP_LABELS = [
  "Welcome",
  "Work description",
  "Business details",
  "Generated setup",
  "Finish",
  "First project",
];

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

function buildFirstProjectAssistState(setup = {}, workDescription = "", businessDetails = {}) {
  const family = extractProjectFamily(setup);
  const agreementDefaults = setup?.agreement_defaults || {};
  const pricing = setup?.pricing_baseline || {};
  const milestones = safeArray(setup?.milestone_tendencies);
  const summary = safeText(setup?.summary) || "Your setup is ready.";
  const projectTitle =
    safeText(agreementDefaults?.project_type) ||
    safeText(family.project_family_label) ||
    "First Project";
  const projectSummary = safeText(workDescription) || summary;

  return {
    assistantIntent: "first_project_assist",
    activationJourney: true,
    assistantWizardStepTarget: 1,
    assistantContext: {
      source: "onboarding_first_project",
      project_family_key: family.project_family_key,
      project_family_label: family.project_family_label,
      workflow_style: safeText(setup?.project_style?.workflow_style),
      materials_behavior: safeText(setup?.project_style?.materials_behavior),
      milestone_count: Number(pricing?.milestone_count || milestones.length || 0),
      pricing_baseline: pricing,
      summary,
      business_details: businessDetails,
    },
    assistantPrefill: {
      project_title: projectTitle,
      project_summary: projectSummary,
      project_class: safeText(businessDetails?.service_area_type) || "residential",
      project_type: safeText(agreementDefaults?.project_type),
      project_subtype: safeText(agreementDefaults?.project_subtype),
      agreement_mode: safeText(agreementDefaults?.agreement_mode) || "standard",
      payment_mode: safeText(agreementDefaults?.payment_mode) || "escrow",
      payment_structure: safeText(agreementDefaults?.payment_structure) || "progress",
      business_details: businessDetails,
    },
    assistantDraftPayload: {
      project_family_key: family.project_family_key,
      project_family_label: family.project_family_label,
      project_title: projectTitle,
      project_summary: projectSummary,
      description: projectSummary,
      project_class: safeText(businessDetails?.service_area_type) || "residential",
      project_type: safeText(agreementDefaults?.project_type),
      project_subtype: safeText(agreementDefaults?.project_subtype),
      agreement_mode: safeText(agreementDefaults?.agreement_mode) || "standard",
      payment_mode: safeText(agreementDefaults?.payment_mode) || "escrow",
      payment_structure: safeText(agreementDefaults?.payment_structure) || "progress",
      business_details: businessDetails,
      selected_template_id: agreementDefaults?.template_id || null,
      selected_template_name_snapshot: safeText(
        agreementDefaults?.suggested_template_label || agreementDefaults?.template_name
      ),
    },
    assistantSuggestedMilestones: milestones.map((row, index) => ({
      title: safeText(row?.title) || `Milestone ${index + 1}`,
      description: safeText(row?.note),
      amount: "",
      start_date: "",
      completion_date: "",
      order: index + 1,
    })),
    assistantEstimatePreview: {
      suggested_price_low: safeText(pricing?.low),
      suggested_price_high: safeText(pricing?.high),
      suggested_total_price: safeText(pricing?.center || pricing?.high || pricing?.low),
      suggested_duration_days: Number(pricing?.duration_days || 0),
      suggested_duration_low_days: Number(pricing?.duration_low_days || 0),
      suggested_duration_high_days: Number(pricing?.duration_high_days || 0),
      milestone_count: Number(pricing?.milestone_count || milestones.length || 0),
      confidence_level: safeText(pricing?.confidence_level) || "medium",
      confidence_reasoning: safeText(pricing?.confidence_reasoning) || summary,
    },
    assistantTemplateRecommendations: agreementDefaults?.template_id
      ? [
          {
            id: agreementDefaults.template_id,
            name: safeText(
              agreementDefaults?.suggested_template_label || agreementDefaults?.template_name
            ),
            project_type: safeText(agreementDefaults?.project_type),
            project_subtype: safeText(agreementDefaults?.project_subtype),
          },
        ]
      : [],
    assistantTopTemplatePreview: agreementDefaults?.template_id
      ? {
          id: agreementDefaults.template_id,
          name: safeText(
            agreementDefaults?.suggested_template_label || agreementDefaults?.template_name
          ),
        }
      : {},
    assistantGuidedFlow: {
      current_step: "first_project",
      project_family_key: family.project_family_key,
      project_family_label: family.project_family_label,
      business_details: businessDetails,
    },
  };
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
    business_details: {
      ...EMPTY_SETUP.business_details,
      ...(next.business_details || next.generated_setup?.business_details || {}),
    },
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
  const completed = step < current;
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
        active
          ? "bg-blue-600 text-white shadow-md shadow-blue-200"
          : completed
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-100 text-slate-500"
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
      className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm shadow-blue-50"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
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

export default function ContractorOnboardingForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setProjectFamilyContext } = useWorkspaceProjectFamilyContext();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(EMPTY_SETUP);
  const [workDescription, setWorkDescription] = useState("");
  const [businessDetails, setBusinessDetails] = useState(EMPTY_SETUP.business_details);
  const [showAdjust, setShowAdjust] = useState(false);
  const [quickAdjustmentNotes, setQuickAdjustmentNotes] = useState("");
  const [finished, setFinished] = useState(false);

  const family = useMemo(() => normalizeProjectFamilyContext(setup.project_family), [setup.project_family]);
  const stepTitle = useMemo(() => {
    switch (step) {
      case 2:
        return "Tell us what kind of work you do";
      case 3:
        return "Business details";
      case 4:
        return "Your Project Setup";
      case 5:
        return "Your setup is ready";
      case 6:
        return "Let’s create your first project";
      default:
        return "Let’s set up how you run your projects";
    }
  }, [step]);

  const loadSetup = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/projects/contractors/onboarding/setup/");
      const normalized = normalizeSetup(data);
      setSetup(normalized);
      setWorkDescription(normalized.work_description || "");
      setBusinessDetails({
        ...EMPTY_SETUP.business_details,
        ...(normalized.business_details || normalized.generated_setup?.business_details || {}),
      });
      setFinished(Boolean(normalized.completed_at));
      if (normalized.completed_at) {
        setStep(6);
      } else if (normalized.work_description) {
        setStep(
          normalized.generated_setup?.summary ||
            safeArray(normalized.milestone_tendencies).length ||
            normalized.agreement_defaults?.project_type
            ? 4
            : 3
        );
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
  }, [setProjectFamilyContext]);

  useEffect(() => {
    loadSetup();
  }, [location.key, loadSetup]);

  const persistSetup = async ({
    nextWorkDescription,
    nextBusinessDetails,
    completed = false,
    notes = "",
  }) => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch("/projects/contractors/onboarding/setup/", {
        work_description: nextWorkDescription ?? workDescription,
        business_details: nextBusinessDetails ?? businessDetails,
        completed,
        quick_adjustment_notes: notes,
      });
      const normalized = normalizeSetup(data);
      setSetup(normalized);
      setWorkDescription(normalized.work_description || "");
      setBusinessDetails({
        ...EMPTY_SETUP.business_details,
        ...(normalized.business_details || normalized.generated_setup?.business_details || {}),
      });
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
    setStep(3);
  };

  const continueFromBusinessDetails = async () => {
    const normalized = await persistSetup({
      nextWorkDescription: workDescription,
      nextBusinessDetails: businessDetails,
    });
    if (!normalized) return;
    setStep(4);
  };

  const completeSetup = async () => {
    const normalized = await persistSetup({
      nextWorkDescription: workDescription,
      nextBusinessDetails: businessDetails,
      completed: true,
      notes: quickAdjustmentNotes,
    });
    if (!normalized) return;
    setFinished(true);
    setStep(6);
  };

  const applyExample = (text) => {
    setWorkDescription(text);
    setStep(2);
  };

  const startFirstProject = () => {
    const handoff = buildFirstProjectAssistState(setup, workDescription, businessDetails);
    writeFirstProjectAssistHandoff(handoff);
    navigate("/app/agreements/new/wizard?step=1", {
      state: handoff,
    });
  };

  const goToDashboard = () => {
    navigate("/app/dashboard");
  };

  const projectFamilyPills = safeArray(setup.project_families);
  const milestoneRows = safeArray(setup.milestone_tendencies);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="relative overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-800 via-sky-600 to-amber-300 px-6 py-6 text-white shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.14),transparent_24%)]" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-100/90">
                SMART PROJECT SETUP
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                Let&apos;s set up how you run your projects
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-blue-50/90 sm:text-base">
                Tell us a bit about your work and we&apos;ll build your project setup for you.
              </p>
            </div>
            <div className="relative flex flex-col items-start gap-2 text-xs text-blue-50">
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
              {ONBOARDING_STEP_LABELS.map((label, index) => (
                <div key={label} className="flex items-center gap-3">
                  <StepBadge step={index + 1} current={step} />
                  <div className="min-w-0">
                    <div
                      className={`text-sm font-semibold ${
                        index + 1 === step
                          ? "text-blue-900"
                          : index + 1 < step
                          ? "text-emerald-800"
                          : "text-slate-900"
                      }`}
                    >
                      {label}
                    </div>
                    <div
                      className={`text-xs ${
                        index + 1 === step
                          ? "text-blue-600"
                          : index + 1 < step
                          ? "text-emerald-700"
                          : "text-slate-500"
                      }`}
                    >
                      {index + 1 === 1
                        ? "Start here"
                        : index + 1 === 2
                        ? "Describe your work"
                        : index + 1 === 3
                        ? "Set business details"
                        : index + 1 === 4
                        ? "Review the generated setup"
                        : index + 1 === 5
                        ? "Confirm your setup"
                        : "Launch your first project"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
                Current family
              </div>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {family.project_family_label || "General project review"}
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
                <div className="animate-pulse rounded-2xl bg-blue-50 px-4 py-6 text-sm text-slate-500">
                  Loading your contractor setup...
                </div>
              </SectionCard>
            ) : null}

            {!loading && step === 1 ? (
              <SectionCard
                eyebrow={`Step 1 of 6`}
                title={stepTitle}
                description="You give us one sentence and we build your default setup."
                testId="contractor-onboarding-welcome"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => beginFlow()}
                    className="rounded-2xl bg-blue-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    onClick={() => applyExample("Kitchen remodels and cabinet installs")}
                    className="rounded-2xl border border-blue-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50"
                  >
                    Example: Kitchen remodels and cabinet installs
                  </button>
                  <button
                    type="button"
                    onClick={() => applyExample("Roofing and repairs")}
                    className="rounded-2xl border border-blue-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50"
                  >
                    Example: Roofing and repairs
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step >= 2 ? (
              <SectionCard
                eyebrow={`Step ${Math.min(step, 6)} of 6`}
                title={stepTitle}
                description="Keep it short. A sentence is enough."
                testId="contractor-onboarding-description"
              >
                <textarea
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  rows={5}
                  className="w-full rounded-3xl border border-blue-100 px-4 py-3 text-base focus:border-blue-400 focus:outline-none"
                  placeholder="What kind of work do you usually do?"
                />
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setWorkDescription("Kitchen remodels and cabinet installs")}
                    className="rounded-full border border-blue-200 px-3 py-1.5 text-slate-700 hover:bg-blue-50"
                  >
                    Kitchen remodels and cabinet installs
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkDescription("Roofing and repairs")}
                    className="rounded-full border border-blue-200 px-3 py-1.5 text-slate-700 hover:bg-blue-50"
                  >
                    Roofing and repairs
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkDescription("General handyman work")}
                    className="rounded-full border border-blue-200 px-3 py-1.5 text-slate-700 hover:bg-blue-50"
                  >
                    General handyman work
                  </button>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => goToStep(1)}
                    className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={continueFromDescription}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {saving ? "Building setup..." : "Continue"}
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step === 3 ? (
              <SectionCard
                eyebrow="Step 3 of 6"
                title="Business details"
                description="A few light settings help tailor the generated setup without slowing you down."
                testId="contractor-onboarding-business-details"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block rounded-2xl border border-blue-100 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">Service type</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Who do you typically work for?
                    </div>
                    <select
                      value={safeText(businessDetails.service_area_type || "both")}
                      onChange={(e) =>
                        setBusinessDetails((current) => ({
                          ...current,
                          service_area_type: e.target.value,
                        }))
                      }
                      className="mt-3 w-full rounded-2xl border border-blue-100 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                      data-testid="contractor-onboarding-business-type"
                    >
                      <option value="residential">Residential</option>
                      <option value="commercial">Commercial</option>
                      <option value="both">Both</option>
                    </select>
                  </label>

                  <label className="block rounded-2xl border border-blue-100 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">Service radius</div>
                    <div className="mt-1 text-sm text-slate-600">
                      How far do you normally travel for work?
                    </div>
                    <select
                      value={String(businessDetails.service_radius_miles || 25)}
                      onChange={(e) =>
                        setBusinessDetails((current) => ({
                          ...current,
                          service_radius_miles: Number(e.target.value || 25),
                        }))
                      }
                      className="mt-3 w-full rounded-2xl border border-blue-100 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                      data-testid="contractor-onboarding-service-radius"
                    >
                      {[10, 25, 50, 100].map((miles) => (
                        <option key={miles} value={miles}>
                          {miles} miles
                        </option>
                      ))}
                    </select>
                  </label>

                  {[
                    {
                      key: "emergency_services",
                      label: "Emergency services",
                      description: "Open to urgent calls and same-day response?",
                    },
                    {
                      key: "licensed",
                      label: "Licensed",
                      description: "You currently operate with a trade license.",
                    },
                    {
                      key: "insured",
                      label: "Insured",
                      description: "You carry active insurance coverage.",
                    },
                  ].map((item) => {
                    const checked = Boolean(businessDetails[item.key]);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        onClick={() =>
                          setBusinessDetails((current) => ({
                            ...current,
                            [item.key]: !Boolean(current[item.key]),
                          }))
                        }
                        className={`rounded-2xl border p-4 text-left transition ${
                          checked
                            ? "border-blue-600 bg-blue-50 text-blue-900"
                            : "border-blue-100 bg-white text-slate-700 hover:bg-blue-50"
                        }`}
                        data-testid={`contractor-onboarding-${item.key}`}
                      >
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                        <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em]">
                          {checked ? "Enabled" : "Off"}
                        </div>
                      </button>
                    );
                  })}

                  {[
                    {
                      key: "accepts_diy_assistance",
                      label: "DIY Assistance",
                      description: "Offer guided DIY projects and collaborative support.",
                    },
                    {
                      key: "accepts_consultation_only",
                      label: "Consultation",
                      description: "Offer advice and planning without full execution.",
                    },
                    {
                      key: "accepts_inspection_only",
                      label: "Inspection Services",
                      description: "Offer inspection visits and review support.",
                    },
                  ].map((item) => {
                    const checked = Boolean(businessDetails[item.key]);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        onClick={() =>
                          setBusinessDetails((current) => ({
                            ...current,
                            [item.key]: !Boolean(current[item.key]),
                          }))
                        }
                        className={`rounded-2xl border p-4 text-left transition ${
                          checked
                            ? "border-blue-600 bg-blue-50 text-blue-900"
                            : "border-blue-100 bg-white text-slate-700 hover:bg-blue-50"
                        }`}
                        data-testid={`contractor-onboarding-${item.key}`}
                      >
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                        <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em]">
                          {checked ? "Enabled" : "Off"}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={continueFromBusinessDetails}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {saving ? "Updating..." : "Build my setup"}
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!loading && step >= 4 ? (
              <SectionCard
                eyebrow="Step 4 of 6"
                title="Your Project Setup"
                description={setup.summary || "We generated a usable starting setup from your work type."}
                testId="contractor-onboarding-generated-setup"
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
                      Work Profile
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {family.project_family_label || "General project review"}
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

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
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

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
                      Suggested Plan Structure
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {setup.pricing_baseline?.milestone_count || milestoneRows.length || 3} milestones
                    </div>
                    <div className="mt-3 space-y-2">
                      {milestoneRows.length ? (
                        milestoneRows.map((row, index) => (
                        <div key={`${row.title || index}`} className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                            <span className="font-semibold text-slate-900">{row.title || `Milestone ${index + 1}`}</span>
                            {row.note ? <span className="text-slate-500"> - {row.note}</span> : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                          We will use a safe default milestone plan if the system cannot narrow it further.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
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

                <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
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
                      <div key={label} className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">
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
                      className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      Adjust
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={completeSetup}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {saving ? "Saving setup..." : "Looks good"}
                  </button>
                </div>

                {showAdjust ? (
                  <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
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
                      className="mt-3 w-full rounded-2xl border border-blue-100 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    />
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdjust(false);
                          setQuickAdjustmentNotes("");
                        }}
                        className="rounded-2xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const normalized = await persistSetup({
                            nextWorkDescription: workDescription,
                            nextBusinessDetails: businessDetails,
                            notes: quickAdjustmentNotes,
                          });
                          if (!normalized) return;
                          setShowAdjust(false);
                        }}
                        className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
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
                eyebrow="Step 5 of 6"
                title="Your setup is ready"
                description="Confirm it now, then launch your first project."
                testId="contractor-onboarding-finish"
              >
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={completeSetup}
                    disabled={saving}
                    className="min-h-12 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    {saving ? "Saving setup..." : "Looks good"}
                  </button>
                  <button
                    type="button"
                    onClick={goToDashboard}
                    className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Go to Dashboard
                  </button>
                </div>
                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  {finished
                    ? "Your setup is saved and ready to use across dashboard, agreement builder, templates, and AI context."
                    : "Your setup is ready. Confirm it to launch your first project."}
                </div>
              </SectionCard>
            ) : null}

            {!loading && step === 6 ? (
              <SectionCard
                eyebrow="First Project Assist"
                title="Let’s create your first project"
                description="We already filled in the family, workflow, plan structure, and AI context from onboarding."
                testId="contractor-onboarding-first-project"
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
                      Ready to launch
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {family.project_family_label || "General project review"}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {setup.project_style?.workflow_style ||
                        "We will use your onboarding setup as the starting point."}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">
                      What is prefilled
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      Agreement wizard, milestone suggestions, template filtering, and AI context all start from the same setup.
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={startFirstProject}
                    className="min-h-12 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Start project
                  </button>
                  <button
                    type="button"
                    onClick={goToDashboard}
                    className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Go to Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/app/onboarding/stripe")}
                    className="min-h-12 rounded-2xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Set up payments
                  </button>
                </div>
                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  You can jump straight into the first agreement with your onboarding setup already loaded.
                </div>
              </SectionCard>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
