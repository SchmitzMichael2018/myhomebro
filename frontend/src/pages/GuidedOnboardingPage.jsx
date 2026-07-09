import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LifeBuoy } from "lucide-react";

import {
  getGuidedExperienceRole,
  GuidedAssistantTips,
  HelpCenterPanel,
  ProgressChecklist,
  RoleWalkthrough,
  SmartEmptyState,
  WorkspaceWalkthroughCards,
} from "../components/guidance/GuidedExperience.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { useWhoAmI } from "../hooks/useWhoAmI.js";

function roleLabel(role) {
  if (role === "property_manager") return "Property Manager";
  if (role === "admin") return "Administrator";
  if (role === "customer") return "Customer";
  return "Contractor";
}

export default function GuidedOnboardingPage() {
  const { data: identity, loading } = useWhoAmI();
  const role = useMemo(() => getGuidedExperienceRole(identity), [identity]);

  if (loading) {
    return (
      <ContractorPageSurface>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600" data-testid="guided-onboarding-loading">
          Loading guided experience...
        </div>
      </ContractorPageSurface>
    );
  }

  return (
    <ContractorPageSurface>
      <div className="space-y-6" data-testid="guided-onboarding-page">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Guided Experience</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[#18395f]">Welcome, {roleLabel(role)}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Learn where work belongs in MyHomeBro, what each workspace expects from you, and how Project Assistant can help without taking control.
              </p>
            </div>
            <Link
              to="/app/assistant"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700 hover:bg-white"
            >
              Open Project Assistant
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <RoleWalkthrough role={role} />

        <GuidedAssistantTips role={role} />

        <ProgressChecklist />

        <WorkspaceWalkthroughCards />

        <SmartEmptyState
          testId="guided-smart-empty-state"
          title="A workspace may start empty"
          nextStep="Use the empty state to understand what belongs there and which safe next action fills it."
          assistantTip="Ask what happens here, what is missing, or what draft can be prepared for human review."
        />

        <HelpCenterPanel />

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="guided-help-routing">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <LifeBuoy className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
            Need more help?
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use Support for account-specific questions. Use Project Assistant for contextual explanation, missing information, draft preparation, and safe next-step guidance.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/app/support" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">
              Open Support
            </Link>
            <Link to="/app/assistant" className="rounded-xl bg-[#18395f] px-4 py-2 text-sm font-black text-white">
              Ask Project Assistant
            </Link>
          </div>
        </section>
      </div>
    </ContractorPageSurface>
  );
}
