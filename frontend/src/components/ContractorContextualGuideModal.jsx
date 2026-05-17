import React from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, X } from "lucide-react";

const MODAL_COPY = {
  prefilled_profile: {
    title: "We prepared your business profile",
    message: "We prepared your business profile using public business information.",
    details: [
      "Nothing has been sent to a homeowner without your confirmation.",
      "You can edit or remove any prefilled business information.",
    ],
    actionLabel: "Review Profile",
  },
  public_leads: {
    title: "Public Leads are homeowner requests",
    message: "Public Leads are homeowner requests connected to your profile and service area.",
    details: ["Review the request details, then accept or decline when you are ready."],
    actionLabel: "Open Leads Workspace",
  },
  first_homeowner_opportunity: {
    title: "A homeowner selected your business",
    message: "A homeowner selected your business for project review.",
    details: ["Nothing has been sent to a homeowner without your confirmation."],
    actionLabel: "Review Public Leads",
  },
  draft_agreement: {
    title: "Draft agreement prepared",
    message: "This draft agreement was prepared from the homeowner intake to save setup time.",
    details: ["Draft agreements are starting points, not final contracts."],
    actionLabel: "Open Draft Agreement",
  },
};

export function pickContextualGuide(summary, preferredSections = []) {
  const sections = summary?.guide_sections || {};
  const ordered = preferredSections.length
    ? preferredSections
    : ["prefilled_profile", "public_leads", "draft_agreement", "traditional_onboarding"];
  for (const key of ordered) {
    const section = sections[key];
    if (section?.visible && !section.completed && !section.dismissed) {
      if (key === "public_leads" && summary?.pending_opportunity_count === 1) {
        return { key: "first_homeowner_opportunity", sectionKey: key, section };
      }
      return { key, sectionKey: key, section };
    }
  }
  return null;
}

export default function ContractorContextualGuideModal({ guide, onDismiss }) {
  const navigate = useNavigate();
  if (!guide) return null;

  const copy = MODAL_COPY[guide.key] || {
    title: guide.section?.title || "Helpful next step",
    message: guide.section?.description || "",
    details: [],
    actionLabel: guide.section?.action_label || "Open",
  };
  const actionUrl = guide.section?.action_url || "";

  const dismiss = () => onDismiss?.(guide.sectionKey || guide.key);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 py-6"
      role="dialog"
      aria-modal="true"
      data-testid="contractor-contextual-guide-modal"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-indigo-600 p-2 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-950">{copy.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{copy.message}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Dismiss guide"
            data-testid="contractor-contextual-guide-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {copy.details.length ? (
          <ul className="mt-4 space-y-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
            {copy.details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            data-testid="contractor-contextual-guide-dismiss"
          >
            Dismiss
          </button>
          {actionUrl ? (
            <button
              type="button"
              onClick={() => navigate(actionUrl)}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              data-testid="contractor-contextual-guide-action"
            >
              {copy.actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
