import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import api from "../api.js";
import { buildTemplateDraftPreview } from "../lib/startWithAiAssistant.js";
import { calculateProfileCompleteness } from "../lib/profileCompleteness.js";
import { getFirstIncompleteStep, ONBOARDING_STEPS } from "../lib/onboardingState.js";

const POPULAR_TRADES = [
  "Roofing",
  "Flooring",
  "HVAC",
  "Plumbing",
  "Electrical",
  "General Contracting",
  "Remodeling",
  "Painting",
  "Landscaping",
];

const PHASE_ORDER = [
  "business_name",
  "contact",
  "service_area",
  "trade_profile",
  "project_path",
  "stripe_intro",
  "template_offer",
  "summary",
];

function getStartPhase(profile, stripeConnected) {
  const incompleteStep = getFirstIncompleteStep(profile, stripeConnected);
  if (!incompleteStep || incompleteStep === ONBOARDING_STEPS.BUSINESS_INFO) return "business_name";
  if (incompleteStep === ONBOARDING_STEPS.TRADE_PROFILE) return "trade_profile";
  if (incompleteStep === ONBOARDING_STEPS.SERVICE_AREA) return "service_area";
  if (incompleteStep === ONBOARDING_STEPS.STRIPE_CONNECT) return "stripe_intro";
  return "business_name";
}

function nextPhase(current) {
  const idx = PHASE_ORDER.indexOf(current);
  return idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : "done";
}

// ── UI atoms ────────────────────────────────────────────────────────────────

function AiMessage({ children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        AI
      </div>
      <div className="max-w-prose rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800">
        {children}
      </div>
    </div>
  );
}

function UserMessage({ children }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-prose rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm leading-6 text-white">
        {children}
      </div>
    </div>
  );
}

function Chip({ children, selected = false, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        selected
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function SaveError({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {message}
    </div>
  );
}

// ── OnboardingConversation ───────────────────────────────────────────────────

export default function OnboardingConversation({
  contractorProfile = null,
  stripeStatus = null,
  mode = "first_login",
  onComplete,
}) {
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const stripeConnected = Boolean(stripeStatus?.connected);

  // Determine start phase for resume_onboarding
  const initialPhase =
    mode === "resume_onboarding"
      ? getStartPhase(contractorProfile || {}, stripeConnected)
      : "business_name";

  const [phase, setPhase] = useState(initialPhase);
  const [messages, setMessages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Per-phase input state
  const [businessName, setBusinessName] = useState(String(contractorProfile?.business_name || ""));
  const [phone, setPhone] = useState(String(contractorProfile?.phone || contractorProfile?.phone_number || ""));
  const [email, setEmail] = useState(String(contractorProfile?.email || ""));
  const [city, setCity] = useState(String(contractorProfile?.city || ""));
  const [state, setState] = useState(String(contractorProfile?.state || ""));
  const [selectedTrades, setSelectedTrades] = useState(Array.isArray(contractorProfile?.skills) ? contractorProfile.skills : []);
  const [projectPath, setProjectPath] = useState("");
  const [templateDraft, setTemplateDraft] = useState(null);
  const [completenessResult, setCompletenessResult] = useState(null);

  const firstName = String(contractorProfile?.first_name || contractorProfile?.name || "").split(" ")[0] || "there";

  // Seed the first AI message based on phase
  useEffect(() => {
    const greetings = {
      business_name:
        mode === "first_login"
          ? `Welcome to MyHomeBro, ${firstName}. I'm your AI assistant — let me help you get set up in a few quick steps. What's your business name?`
          : `Welcome back, ${firstName}. Let's finish setting up your profile. What's your business name?`,
      trade_profile: `Hi ${firstName} — let's pick up where you left off. Which trades do you offer? Select all that apply.`,
      service_area: `Got it. What city and state do you primarily work in? I'll use this to keep recommendations relevant.`,
      stripe_intro: `One more thing: connecting your bank account lets you receive payments directly from MyHomeBro. It takes about 2 minutes and you only do it once.`,
    };
    const message = greetings[phase] || greetings["business_name"];
    setMessages([{ role: "ai", text: message }]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  function addAiMessage(text) {
    setMessages((prev) => [...prev, { role: "ai", text }]);
  }

  function addUserMessage(text) {
    setMessages((prev) => [...prev, { role: "user", text }]);
  }

  async function patchProfile(payload) {
    try {
      setSaving(true);
      setSaveError("");
      await api.patch("/projects/contractors/me/", payload);
    } catch {
      setSaveError("Couldn't save right now — you can update this from your profile later.");
    } finally {
      setSaving(false);
    }
  }

  function advance(toPhase) {
    setPhase(toPhase || nextPhase(phase));
  }

  // ── Phase handlers ──────────────────────────────────────────────────────

  async function handleBusinessName() {
    const name = businessName.trim();
    if (!name) return;
    addUserMessage(name);
    await patchProfile({ business_name: name });
    addAiMessage(`Great, ${name}. Now let me grab your contact details — what's your business phone and email?`);
    advance("contact");
  }

  async function handleContact() {
    const parts = [phone.trim(), email.trim()].filter(Boolean);
    if (!parts.length) {
      advance("contact");
      return;
    }
    addUserMessage(parts.join(" · "));
    await patchProfile({ phone: phone.trim() || undefined, email: email.trim() || undefined });
    addAiMessage("Got it. Where do you primarily work? Just a city and state is enough to keep recommendations relevant.");
    advance("service_area");
  }

  async function handleServiceArea() {
    const location = [city.trim(), state.trim()].filter(Boolean).join(", ");
    if (!location) {
      advance("service_area");
      return;
    }
    addUserMessage(location);
    await patchProfile({ city: city.trim() || undefined, state: state.trim() || undefined });
    addAiMessage("Perfect. Which trades do you offer? Select everything that applies — you can always add more from your profile.");
    advance("trade_profile");
  }

  async function handleTradeProfile() {
    if (!selectedTrades.length) {
      advance("trade_profile");
      return;
    }
    addUserMessage(selectedTrades.join(", "));
    await patchProfile({ skills: selectedTrades });
    addAiMessage("Nice. One last quick question — do you mostly work on residential jobs, commercial jobs, or both?");
    advance("project_path");
  }

  async function handleProjectPath(value) {
    setProjectPath(value);
    addUserMessage(value === "both" ? "Both residential and commercial" : value.charAt(0).toUpperCase() + value.slice(1));
    try {
      await api.patch("/projects/contractors/onboarding/", { preferred_project_path: value });
    } catch {
      // non-blocking: the preference may not yet be a backend field — that's OK
    }
    addAiMessage("Got it. Now — to receive payments through MyHomeBro, I'll need to connect your bank account. Stripe handles this securely. It takes about 2 minutes and you only do it once.");
    advance("stripe_intro");
  }

  function handleStripeConnect() {
    addUserMessage("Connect my bank");
    navigate("/app/onboarding/stripe");
  }

  function handleStripeSkip() {
    addUserMessage("I'll do this later");
    // Offer first template
    const firstTrade = selectedTrades[0] || "";
    if (firstTrade) {
      const draft = buildTemplateDraftPreview(firstTrade, {});
      setTemplateDraft(draft);
      addAiMessage(
        `No problem — you can connect anytime from your profile. Based on your trade selection, here's a starter template I built for "${draft.template_name || firstTrade}". Want to open it?`
      );
    } else {
      addAiMessage("No problem — you can connect anytime from your profile. Skipping to your profile summary.");
      advance("summary");
      buildSummary();
      return;
    }
    advance("template_offer");
  }

  function handleTemplateAccept() {
    addUserMessage("Open templates");
    navigate("/app/templates");
  }

  function handleTemplateSkip() {
    addUserMessage("Skip for now");
    advance("summary");
    buildSummary();
  }

  function buildSummary() {
    const result = calculateProfileCompleteness(contractorProfile || {}, {
      stripeConnected,
      templateCount: 0,
      jobCount: 0,
    });
    setCompletenessResult(result);
    const score = result.score;
    const topMissing = result.highestValueMissing;
    const summaryMessage =
      score >= 80
        ? `You're all set — your profile is ${score}% complete. You can start building your first agreement right now.`
        : topMissing
        ? `Your profile is ${score}% complete. The highest-value next step: ${topMissing.valueReason} I'll remind you over time as your profile grows.`
        : `Your profile is ${score}% complete. You're ready to start working in MyHomeBro.`;
    addAiMessage(summaryMessage);
    advance("done");
  }

  // ── Render phases ────────────────────────────────────────────────────────

  function renderPhaseInput() {
    if (phase === "done") {
      return (
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            data-testid="onboarding-go-to-workspace"
            onClick={() => {
              if (typeof onComplete === "function") onComplete();
              navigate("/app/assistant");
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Go to AI Workspace
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/app/dashboard")}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Go to Dashboard
          </button>
        </div>
      );
    }

    if (phase === "business_name") {
      return (
        <div className="flex gap-2 pt-2">
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleBusinessName()}
            placeholder="Your business name"
            data-testid="onboarding-business-name-input"
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="button"
            disabled={!businessName.trim() || saving}
            onClick={handleBusinessName}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
          <button type="button" onClick={() => { addUserMessage("Skip"); advance("contact"); addAiMessage("No problem. What's your business phone and email?"); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
            Skip
          </button>
        </div>
      );
    }

    if (phase === "contact") {
      return (
        <div className="space-y-2 pt-2">
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              data-testid="onboarding-phone-input"
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Business email"
              data-testid="onboarding-email-input"
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleContact}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
            <button type="button" onClick={() => { advance("service_area"); addAiMessage("Where do you primarily work? City and state is fine."); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
              Skip
            </button>
          </div>
        </div>
      );
    }

    if (phase === "service_area") {
      return (
        <div className="space-y-2 pt-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              data-testid="onboarding-city-input"
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
            />
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="State (e.g. TX)"
              data-testid="onboarding-state-input"
              className="w-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
              maxLength={2}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleServiceArea}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
            <button type="button" onClick={() => { advance("trade_profile"); addAiMessage("Which trades do you offer?"); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
              Skip
            </button>
          </div>
        </div>
      );
    }

    if (phase === "trade_profile") {
      return (
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap gap-2">
            {POPULAR_TRADES.map((trade) => (
              <Chip
                key={trade}
                selected={selectedTrades.includes(trade)}
                onClick={() =>
                  setSelectedTrades((prev) =>
                    prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade]
                  )
                }
                testId={`onboarding-trade-${trade.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {trade}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleTradeProfile}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : selectedTrades.length ? `Confirm ${selectedTrades.length} trade${selectedTrades.length > 1 ? "s" : ""}` : "Continue"}
            </button>
            <button type="button" onClick={() => { advance("project_path"); addAiMessage("Do you work on residential, commercial, or both?"); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
              Skip
            </button>
          </div>
        </div>
      );
    }

    if (phase === "project_path") {
      return (
        <div className="flex flex-wrap gap-3 pt-2">
          {[
            { value: "residential", label: "Residential" },
            { value: "commercial", label: "Commercial" },
            { value: "both", label: "Both" },
          ].map(({ value, label }) => (
            <Chip key={value} onClick={() => handleProjectPath(value)} testId={`onboarding-path-${value}`}>
              {label}
            </Chip>
          ))}
          <Chip onClick={() => { advance("stripe_intro"); addAiMessage("To receive payments through MyHomeBro, I need to connect your bank account. It takes about 2 minutes."); }}>
            Skip
          </Chip>
        </div>
      );
    }

    if (phase === "stripe_intro") {
      return (
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            data-testid="onboarding-stripe-connect"
            onClick={handleStripeConnect}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Connect my bank →
          </button>
          <button
            type="button"
            data-testid="onboarding-stripe-skip"
            onClick={handleStripeSkip}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Do this later
          </button>
        </div>
      );
    }

    if (phase === "template_offer" && templateDraft) {
      return (
        <div className="space-y-3 pt-2">
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
              {templateDraft.project_type || "Template"}
            </div>
            <div className="mt-1 text-base font-semibold text-indigo-950">
              {templateDraft.template_name}
            </div>
            <div className="mt-2 text-sm text-indigo-900/80 line-clamp-2">
              {templateDraft.description}
            </div>
            <div className="mt-3 text-xs text-indigo-700">
              {Array.isArray(templateDraft.milestones) ? templateDraft.milestones.length : 0} milestones · Advisory pricing included
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleTemplateAccept} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
              Open Templates <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={handleTemplateSkip} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
              Skip for now
            </button>
          </div>
        </div>
      );
    }

    // template_offer without draft or default
    if (phase === "template_offer") {
      return (
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={() => navigate("/app/templates")} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
            Browse Templates <ArrowRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => { advance("summary"); buildSummary(); }} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
            Skip for now
          </button>
        </div>
      );
    }

    return null;
  }

  return (
    <div
      className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8"
      data-testid="onboarding-conversation"
    >
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        {mode === "resume_onboarding" ? "Resuming setup" : "Getting started"}
      </div>
      <h2 className="text-2xl font-bold text-slate-900">
        {mode === "resume_onboarding" ? "Let's finish your setup" : "Welcome to MyHomeBro"}
      </h2>

      {/* Completeness bar — only shown in summary phase */}
      {completenessResult && phase === "done" ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">Profile completeness</span>
            <span className="font-bold text-slate-900">{completenessResult.score}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${completenessResult.score}%` }}
            />
          </div>
          {completenessResult.highestValueMissing ? (
            <div className="mt-2 text-xs text-slate-500">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
              Next: {completenessResult.highestValueMissing.valueReason}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Message thread */}
      <div className="mt-5 space-y-4">
        {messages.map((msg, idx) =>
          msg.role === "ai" ? (
            <AiMessage key={idx}>{msg.text}</AiMessage>
          ) : (
            <UserMessage key={idx}>{msg.text}</UserMessage>
          )
        )}
      </div>

      {/* Current phase input */}
      <div className="mt-4">
        <SaveError message={saveError} />
        {renderPhaseInput()}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
