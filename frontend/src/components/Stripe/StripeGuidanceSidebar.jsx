import React, { useState } from "react";
import {
  STRIPE_GUIDANCE,
  getStepGuidance,
  getEntityGuidance,
} from "../../lib/stripeGuidanceContent.js";

const ENTITY_LABELS = {
  sole_proprietor: "Sole proprietor",
  llc: "LLC",
  corporation: "Corporation",
};

const FAQ_KEYS = ["ssn_why", "is_safe", "when_paid", "no_ein", "personal_account"];

function GuidanceCard({ children, tone = "default" }) {
  const cls =
    tone === "info"
      ? "border-sky-200 bg-sky-50"
      : tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : "border-slate-200 bg-slate-50";
  return (
    <div className={`rounded-2xl border px-4 py-4 ${cls}`}>
      <div className="text-sm leading-6 text-slate-700">{children}</div>
    </div>
  );
}

export default function StripeGuidanceSidebar({ step = "", entityType = null, onFaqQuestion }) {
  const [expandedFaqKey, setExpandedFaqKey] = useState(null);

  const stepText = getStepGuidance(step);
  const entityText = getEntityGuidance(entityType);
  const entityLabel = ENTITY_LABELS[entityType] || null;

  function handleFaqChip(key) {
    setExpandedFaqKey((current) => (current === key ? null : key));
    if (typeof onFaqQuestion === "function") onFaqQuestion(key);
  }

  return (
    <div
      className="space-y-4"
      data-testid="stripe-guidance-sidebar"
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          What to expect
        </div>
        <div className="mt-3 space-y-3">
          <GuidanceCard>
            {STRIPE_GUIDANCE.intro.default}
          </GuidanceCard>

          {entityText ? (
            <GuidanceCard tone="info">
              {entityLabel ? (
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                  {entityLabel}
                </div>
              ) : null}
              {entityText}
            </GuidanceCard>
          ) : null}

          {stepText !== STRIPE_GUIDANCE.step.default || step ? (
            <GuidanceCard tone="info">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                Current step
              </div>
              {stepText}
            </GuidanceCard>
          ) : null}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Common questions
        </div>
        <div className="mt-3 space-y-2">
          {FAQ_KEYS.map((key) => {
            const item = STRIPE_GUIDANCE.faq[key];
            if (!item) return null;
            const isOpen = expandedFaqKey === key;
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => handleFaqChip(key)}
                  data-testid={`stripe-faq-${key}`}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                    isOpen
                      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {item.q}
                </button>
                {isOpen ? (
                  <div className="mt-1 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-sm leading-6 text-indigo-900">
                    {item.a}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
