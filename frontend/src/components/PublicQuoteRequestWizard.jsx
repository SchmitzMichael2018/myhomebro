import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import Modal from "./Modal.jsx";
import { improveContractorQuoteDescription, requestContractorQuote } from "../api";

const STORAGE_PREFIX = "mhb-quote-request-draft:";

const STEPS = [
  { key: "basics", label: "Project Basics" },
  { key: "clarifiers", label: "Project Clarifiers" },
  { key: "photos", label: "Photos" },
  { key: "details", label: "Timing + Property + Budget" },
  { key: "contact", label: "Contact Info" },
  { key: "review", label: "Review + Submit" },
];

const PROJECT_CLASS_OPTIONS = [
  ["residential", "Residential"],
  ["commercial", "Commercial"],
];

const CONTACT_METHOD_OPTIONS = [
  ["", "Choose a preference"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["text", "Text message"],
];

const TIMING_OPTIONS = [
  ["", "Select timing"],
  ["asap", "ASAP"],
  ["within_2_weeks", "Within 2 weeks"],
  ["within_month", "Within 1 month"],
  ["1_to_3_months", "1 to 3 months"],
  ["flexible", "Flexible"],
];

const BUDGET_OPTIONS = [
  ["", "Select budget range"],
  ["under_5k", "Under $5k"],
  ["5k_to_15k", "$5k - $15k"],
  ["15k_to_30k", "$15k - $30k"],
  ["30k_to_75k", "$30k - $75k"],
  ["75k_plus", "$75k+"],
  ["not_sure", "Not sure yet"],
];

function safeText(value) {
  return String(value || "").trim();
}

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function buildQuestionSet({ projectType, projectSubtype, propertyType }) {
  const text = `${safeText(projectType)} ${safeText(projectSubtype)} ${safeText(propertyType)}`.toLowerCase();
  if (/(kitchen|bath|bathroom|remodel|renovation)/.test(text)) {
    return [
      { key: "scope_priority", label: "What part of the project matters most right now?", placeholder: "E.g. layout, finishes, fixtures, or function" },
      { key: "site_conditions", label: "Anything we should know about the current space?", placeholder: "E.g. demo needed, tight access, old materials, water damage" },
      { key: "materials_preferences", label: "Do you have any style or material preferences?", placeholder: "E.g. modern, durable, budget-friendly, premium" },
    ];
  }
  if (/(roof|siding|exterior)/.test(text)) {
    return [
      { key: "scope_priority", label: "What problem are you seeing?", placeholder: "E.g. leak, aging materials, storm damage, curb appeal" },
      { key: "site_conditions", label: "Any access or safety details we should know?", placeholder: "E.g. steep roof, second story, tight side yard" },
      { key: "materials_preferences", label: "Any material or warranty preferences?", placeholder: "E.g. color, durability, budget level" },
    ];
  }
  if (/(plumb|hvac|electrical|heat|cooling)/.test(text)) {
    return [
      { key: "scope_priority", label: "What system needs attention?", placeholder: "E.g. faucet, breaker, furnace, AC, outlet" },
      { key: "site_conditions", label: "Is this an urgent issue or a planned upgrade?", placeholder: "E.g. urgent repair or scheduled improvement" },
      { key: "materials_preferences", label: "Any equipment or finish preferences?", placeholder: "E.g. standard replacement, energy efficient, premium" },
    ];
  }
  return [
    { key: "scope_priority", label: "What do you want help with first?", placeholder: "E.g. repair, replacement, remodel, design help" },
    { key: "site_conditions", label: "Anything that could affect the work?", placeholder: "E.g. access, pets, existing damage, permits" },
    { key: "materials_preferences", label: "Any preferences we should keep in mind?", placeholder: "E.g. budget-friendly, premium, certain finish" },
  ];
}

function createInitialDraft() {
  return {
    projectClass: "residential",
    projectType: "",
    projectSubtype: "",
    projectTypeUnknown: false,
    rawDescription: "",
    refinedDescription: "",
    clarifierAnswers: {},
    propertyType: "",
    desiredTiming: "",
    projectAddressLine1: "",
    projectAddressLine2: "",
    projectCity: "",
    projectState: "",
    projectPostalCode: "",
    budgetRangeText: "",
    fullName: "",
    email: "",
    phone: "",
    preferredContactMethod: "",
    contactConsent: false,
  };
}

function loadDraft(slug) {
  if (typeof window === "undefined" || !slug) return createInitialDraft();
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${slug}`);
  if (!raw) return createInitialDraft();
  return { ...createInitialDraft(), ...safeParseJSON(raw, {}) };
}

function buildFormData(draft, files, questions) {
  const form = new FormData();
  form.append("full_name", draft.fullName || "");
  form.append("email", draft.email || "");
  form.append("phone", draft.phone || "");
  form.append("preferred_contact_method", draft.preferredContactMethod || "");
  form.append("contact_consent", draft.contactConsent ? "true" : "false");
  form.append("project_class", draft.projectClass || "residential");
  form.append("property_type", draft.propertyType || "");
  form.append("project_type", draft.projectTypeUnknown ? "" : draft.projectType || "");
  form.append("project_subtype", draft.projectSubtype || "");
  form.append("raw_description", draft.rawDescription || "");
  form.append("refined_description", draft.refinedDescription || "");
  if (draft.desiredTiming) {
    form.append("desired_timing_text", formatTimingLabel(draft.desiredTiming));
  }
  if (draft.budgetRangeText) {
    form.append("budget_range_text", formatBudgetLabel(draft.budgetRangeText));
  }
  form.append("project_address_line1", draft.projectAddressLine1 || "");
  form.append("project_address_line2", draft.projectAddressLine2 || "");
  form.append("project_city", draft.projectCity || "");
  form.append("project_state", draft.projectState || "");
  form.append("project_postal_code", draft.projectPostalCode || "");
  form.append("ai_clarification_questions", JSON.stringify(questions));
  form.append("ai_clarification_answers", JSON.stringify(draft.clarifierAnswers || {}));
  form.append(
    "ai_analysis_payload",
    JSON.stringify({
      property_type: draft.propertyType || "",
      budget_range_text: draft.budgetRangeText ? formatBudgetLabel(draft.budgetRangeText) : "",
      desired_timing_text: draft.desiredTiming ? formatTimingLabel(draft.desiredTiming) : "",
      preferred_contact_method: draft.preferredContactMethod || "",
      contact_consent: Boolean(draft.contactConsent),
      project_class: draft.projectClass || "residential",
      project_type: draft.projectTypeUnknown ? "" : draft.projectType || "",
      project_subtype: draft.projectSubtype || "",
      project_scope_summary: draft.refinedDescription || draft.rawDescription || "",
      refined_description: draft.refinedDescription || draft.rawDescription || "",
    })
  );

  files.forEach((file) => form.append("files", file));
  return form;
}

function formatBudgetLabel(value) {
  if (!safeText(value)) return "-";
  const match = BUDGET_OPTIONS.find(([key]) => key === value);
  return match?.[1] || value || "-";
}

function formatTimingLabel(value) {
  if (!safeText(value)) return "-";
  const match = TIMING_OPTIONS.find(([key]) => key === value);
  return match?.[1] || value || "-";
}

function stepSummaryRows(draft, files) {
  return [
    ["Project", [draft.projectClass, draft.projectType, draft.projectSubtype].filter(Boolean).join(" / ") || "Not set"],
    ["Description", draft.refinedDescription || draft.rawDescription || "Not set"],
    ["Timing", formatTimingLabel(draft.desiredTiming)],
    ["Property", [draft.propertyType, [draft.projectCity, draft.projectState].filter(Boolean).join(", ") || draft.projectPostalCode].filter(Boolean).join(" - ") || "Not set"],
    ["Budget", formatBudgetLabel(draft.budgetRangeText)],
    ["Contact", draft.fullName || draft.email || "Not set"],
    ["Photos", files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Skipped"],
  ];
}

export default function PublicQuoteRequestWizard({
  open = false,
  slug = "",
  contractorName = "",
  businessName = "",
  profile = null,
  onClose = () => {},
  onSubmitted = () => {},
}) {
  const navigate = useNavigate();
  const storageKey = `${STORAGE_PREFIX}${slug}`;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => loadDraft(slug));
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState(null);
  const [descriptionImproving, setDescriptionImproving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft(loadDraft(slug));
    setStep(0);
    setSubmittedResult(null);
    setFiles([]);
  }, [open, slug]);

  useEffect(() => {
    if (!open || typeof window === "undefined" || !slug) return;
    const payload = {
      ...draft,
      projectTypeUnknown: Boolean(draft.projectTypeUnknown),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [draft, open, slug, storageKey]);

  const questions = useMemo(
    () => buildQuestionSet(draft),
    [draft.projectType, draft.projectSubtype, draft.propertyType]
  );

  const previewTitle = useMemo(() => {
    const parts = [draft.projectTypeUnknown ? "Not sure yet" : draft.projectType, draft.projectSubtype].filter(Boolean);
    return parts.join(" / ") || "Your project request";
  }, [draft.projectSubtype, draft.projectType, draft.projectTypeUnknown]);

  const previewDescription = useMemo(
    () => draft.refinedDescription || draft.rawDescription || "Add a short description and we will help shape the request.",
    [draft.rawDescription, draft.refinedDescription]
  );

  function updateDraft(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateClarifierAnswer(key, value) {
    setDraft((prev) => ({
      ...prev,
      clarifierAnswers: {
        ...(prev.clarifierAnswers || {}),
        [key]: value,
      },
    }));
  }

  function clearDraft() {
    setDraft(createInitialDraft());
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (typeof window !== "undefined" && slug) {
      window.localStorage.removeItem(storageKey);
    }
  }

  function handleClose() {
    onClose();
  }

  async function improveDescription() {
    if (!draft.rawDescription.trim()) {
      toast.error("Add a short description first.");
      return;
    }
    try {
      setDescriptionImproving(true);
      const result = await improveContractorQuoteDescription(slug, {
        current_description: draft.rawDescription,
        project_type: draft.projectType,
        project_subtype: draft.projectSubtype,
      });
      const description = String(result?.description || "").trim();
      if (description) {
        setDraft((prev) => ({
          ...prev,
          rawDescription: description,
          refinedDescription: description,
        }));
        toast.success("Description improved.");
      }
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to improve the description.");
    } finally {
      setDescriptionImproving(false);
    }
  }

  async function submitQuote(event) {
    event.preventDefault();
    try {
      setSubmitting(true);
      const payload = buildFormData(draft, files, questions);
      const result = await requestContractorQuote(slug, payload);
      setSubmittedResult(result);
      toast.success("Your quote request was sent.");
      clearDraft();
      onSubmitted(result);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to send your quote request.");
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0));
  }

  const summaryRows = stepSummaryRows(draft, files);
  const companyLabel = contractorName || businessName || profile?.business_name_public || "this contractor";

  if (!open) return null;

  return (
    <Modal
      visible={open}
      title="Request a Quote"
      onClose={handleClose}
      testId="public-quote-request-wizard"
      containerClassName="mx-0 h-[100dvh] max-w-none rounded-none sm:mx-4 sm:h-auto sm:max-w-6xl sm:rounded-2xl"
      bodyClassName="h-[calc(100dvh-64px)] px-0 py-0 sm:h-auto sm:max-h-[82vh]"
    >
      {submittedResult ? (
        <div className="grid gap-6 p-5 sm:p-6">
          <div
            data-testid="public-quote-request-success"
            className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Request submitted
                </div>
                <h3 className="mt-1 text-2xl font-black">Your quote request is on its way.</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-900/80">
                  We sent a confirmation email and the contractor can review your project details in their queue.
                </p>
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3 text-sm font-semibold text-emerald-900">
                  {submittedResult?.lead_id ? `Reference: Lead #${submittedResult.lead_id}` : "Request received"}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              Create an account to keep track of future updates, messages, and agreements in one place.
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate("/signup")}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Create account
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={submitQuote} className="grid min-h-[70vh] gap-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.9fr)]">
          <div className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {STEPS.map((item, index) => (
                  <span
                    key={item.key}
                    className={`rounded-full px-3 py-1 ${
                      index === step
                        ? "bg-slate-900 text-white"
                        : index < step
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {index + 1}. {item.label}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                <h3 data-testid="public-quote-request-step-title" className="text-2xl font-black text-slate-900">{STEPS[step].label}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Share enough detail to help {companyLabel} prepare a clear quote. You can save and finish this draft later.
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {step === 0 ? (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Project type</span>
                      <input
                        data-testid="public-quote-request-project-type"
                        value={draft.projectType}
                        onChange={(e) => updateDraft("projectType", e.target.value)}
                        placeholder="E.g. kitchen remodel, roof repair"
                        className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Project subtype</span>
                      <input
                        data-testid="public-quote-request-project-subtype"
                        value={draft.projectSubtype}
                        onChange={(e) => updateDraft("projectSubtype", e.target.value)}
                        placeholder="Optional detail"
                        className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PROJECT_CLASS_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateDraft("projectClass", value)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          draft.projectClass === value
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateDraft("projectTypeUnknown", !draft.projectTypeUnknown)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        draft.projectTypeUnknown
                          ? "bg-amber-100 text-amber-800"
                          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      I'm not sure
                    </button>
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Short description</span>
                    <textarea
                        data-testid="public-quote-request-description"
                        value={draft.rawDescription}
                      onChange={(e) => updateDraft("rawDescription", e.target.value)}
                      placeholder="Tell the contractor what you want done, what you are seeing, and anything important."
                      rows={7}
                      className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={improveDescription}
                      disabled={descriptionImproving || !draft.rawDescription.trim()}
                      data-testid="public-quote-request-improve-description"
                      className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Sparkles className="h-4 w-4" />
                      {descriptionImproving ? "Improving..." : "Improve Description"}
                    </button>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Optional. If you are not sure, add a rough description and we will help shape it.
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="space-y-4">
                  {questions.map((question) => (
                    <label key={question.key} className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-700">{question.label}</span>
                      <textarea
                        data-testid={`public-quote-request-clarifier-${question.key}`}
                        value={draft.clarifierAnswers?.[question.key] || ""}
                        onChange={(e) => updateClarifierAnswer(question.key, e.target.value)}
                        rows={4}
                        placeholder={question.placeholder}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                      />
                    </label>
                  ))}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                    These answers help the contractor shape the quote. They can still verify measurements and site conditions later.
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    Upload photos if they help explain the request. You can skip this step, and the contractor may still verify final measurements or site conditions.
                  </div>
                  <button
                    type="button"
                    onClick={goNext}
                    data-testid="public-quote-request-skip-photos"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Skip for now
                  </button>
                  <input
                    ref={fileInputRef}
                    data-testid="public-quote-request-photos-input"
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={(e) => {
                      const next = Array.from(e.target.files || []);
                      if (!next.length) return;
                      setFiles((current) => [...current, ...next]);
                      e.target.value = "";
                    }}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
                  />
                  <div className="grid gap-3">
                    {files.length ? (
                      files.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div className="flex items-center gap-3">
                            <ImagePlus className="h-4 w-4 text-slate-500" />
                            <div>
                              <div className="font-semibold text-slate-900">{file.name}</div>
                              <div className="text-xs text-slate-500">{Math.round(file.size / 1024)} KB</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFiles((current) => current.filter((_, idx) => idx !== index))}
                            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                            aria-label={`Remove ${file.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                        No files added yet.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">Desired timing</span>
                    <select
                      data-testid="public-quote-request-timing"
                      value={draft.desiredTiming}
                      onChange={(e) => updateDraft("desiredTiming", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    >
                      {TIMING_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Property type</span>
                    <input
                      data-testid="public-quote-request-property-type"
                      value={draft.propertyType}
                      onChange={(e) => updateDraft("propertyType", e.target.value)}
                      placeholder="House, condo, duplex, office..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Address or ZIP</span>
                    <input
                      data-testid="public-quote-request-address"
                      value={draft.projectAddressLine1}
                      onChange={(e) => updateDraft("projectAddressLine1", e.target.value)}
                      placeholder="Street address or ZIP code"
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">City</span>
                    <input
                      data-testid="public-quote-request-city"
                      value={draft.projectCity}
                      onChange={(e) => updateDraft("projectCity", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">State</span>
                    <input
                      data-testid="public-quote-request-state"
                      value={draft.projectState}
                      onChange={(e) => updateDraft("projectState", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">ZIP code</span>
                    <input
                      data-testid="public-quote-request-postal-code"
                      value={draft.projectPostalCode}
                      onChange={(e) => updateDraft("projectPostalCode", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">Budget range</span>
                    <select
                      data-testid="public-quote-request-budget-range"
                      value={draft.budgetRangeText}
                      onChange={(e) => updateDraft("budgetRangeText", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    >
                      {BUDGET_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">Full name</span>
                    <input
                      data-testid="public-quote-request-full-name"
                      value={draft.fullName}
                      onChange={(e) => updateDraft("fullName", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Email</span>
                    <input
                      data-testid="public-quote-request-email"
                      type="email"
                      value={draft.email}
                      onChange={(e) => updateDraft("email", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Phone</span>
                    <input
                      data-testid="public-quote-request-phone"
                      value={draft.phone}
                      onChange={(e) => updateDraft("phone", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">Preferred contact method</span>
                    <select
                      data-testid="public-quote-request-contact-method"
                      value={draft.preferredContactMethod}
                      onChange={(e) => updateDraft("preferredContactMethod", e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none"
                    >
                      {CONTACT_METHOD_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="md:col-span-2 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <input
                      data-testid="public-quote-request-contact-consent"
                      type="checkbox"
                      checked={draft.contactConsent}
                      onChange={(e) => updateDraft("contactConsent", e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>
                      I agree that {companyLabel} may contact me about this request using the details I shared.
                    </span>
                  </label>
                </div>
              ) : null}

              {step === 5 ? (
                <div className="space-y-5">
                  <div className="grid gap-3">
                    {summaryRows.map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-600">{label}</div>
                        <div className="max-w-[60%] text-right text-sm font-semibold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-600">
                    Final note: this request does not build milestones for you. It only gives the contractor the details needed to prepare a quote and follow up.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Step {step + 1} of {STEPS.length}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={step === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  {step < STEPS.length - 1 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={submitting}
                      data-testid="public-quote-request-submit"
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? "Sending..." : "Send Request"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside data-testid="public-quote-request-preview" className="hidden min-h-0 bg-slate-50 lg:flex lg:flex-col">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Live Preview</div>
              <h4 className="mt-2 text-2xl font-black text-slate-900">{previewTitle}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">{previewDescription}</p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Request snapshot</div>
                <div className="mt-4 space-y-3">
                  {summaryRows.map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                      <div className="text-sm font-semibold text-slate-500">{label}</div>
                      <div className="text-right text-sm font-semibold text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                The contractor will review your request, message you if needed, and can convert this into a draft agreement on their side.
              </div>
            </div>
          </aside>
        </form>
      )}
    </Modal>
  );
}
