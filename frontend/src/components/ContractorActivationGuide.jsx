import React from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, PlayCircle, ShieldCheck, X } from "lucide-react";
import { toast } from "react-hot-toast";

const SECTION_ORDER = [
  "prefilled_profile",
  "public_leads",
  "draft_agreement",
  "traditional_onboarding",
];

function visibleSections(summary) {
  const sections = summary?.guide_sections || {};
  return SECTION_ORDER.map((key) => ({ key, ...(sections[key] || {}) })).filter(
    (section) => section.visible && !section.completed && !section.dismissed
  );
}

export default function ContractorActivationGuide({ summary, onDismiss, className = "" }) {
  const navigate = useNavigate();
  const sections = visibleSections(summary);
  if (!summary?.should_show_activation_guide || sections.length === 0) return null;

  const openAction = (url) => {
    if (!url) return;
    navigate(url);
  };

  return (
    <section
      data-testid="contractor-activation-guide"
      className={`rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-indigo-600 p-2 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-950">Smart activation guide</div>
            <div className="mt-1 max-w-3xl text-sm text-indigo-950">
              This guide adapts to how you entered MyHomeBro and only shows the next context that matters.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss?.("all")}
          className="rounded-full border border-indigo-200 bg-white p-2 text-indigo-700 hover:bg-indigo-100"
          aria-label="Dismiss activation guide"
          data-testid="contractor-activation-dismiss-all"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {sections.map((section) => (
          <article
            key={section.key}
            data-testid={`contractor-activation-section-${section.key}`}
            className="rounded-xl border border-white/80 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-950">{section.title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-700">{section.description}</div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss?.(section.key)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={`Dismiss ${section.title}`}
                data-testid={`contractor-activation-dismiss-${section.key}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {Array.isArray(section.checklist) && section.checklist.length ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {section.checklist.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {section.action_url ? (
                <button
                  type="button"
                  onClick={() => openAction(section.action_url)}
                  className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  data-testid={`contractor-activation-action-${section.key}`}
                >
                  {section.action_label || "Open"}
                </button>
              ) : null}
              {section.key === "traditional_onboarding" ? (
                <button
                  type="button"
                  onClick={() => navigate("/app/onboarding/stripe")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  data-testid="contractor-activation-action-stripe"
                >
                  Open Stripe Onboarding
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toast("Coming soon")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
                data-testid={`contractor-activation-video-${section.key}`}
              >
                <PlayCircle className="h-4 w-4" aria-hidden="true" />
                Watch: How this works
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
