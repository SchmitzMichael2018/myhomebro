import { useMemo } from "react";
import { MessageCircle } from "lucide-react";

import { useAssistantDock } from "../components/AssistantDock.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { getGuidedExperienceRole } from "../components/guidance/GuidedExperience.jsx";
import GuidedExperienceHub from "../components/guidance/GuidedExperienceHub.jsx";
import { getRolePath } from "../components/guidance/guidedExperienceModel.js";
import { useWhoAmI } from "../hooks/useWhoAmI.js";

export default function GuidedOnboardingPage() {
  const { data: identity, loading } = useWhoAmI();
  const role = useMemo(() => getGuidedExperienceRole(identity), [identity]);
  const rolePath = getRolePath(role);
  const { openAssistant } = useAssistantDock();

  if (loading) {
    return (
      <ContractorPageSurface variant="operational">
        <div className="guided-hub__loading" data-testid="guided-onboarding-loading" role="status">
          Loading your guided experience…
        </div>
      </ContractorPageSurface>
    );
  }

  return (
    <ContractorPageSurface
      variant="operational"
      eyebrow="Guided Help"
      title={`Your ${rolePath.label.toLowerCase()} experience`}
      subtitle="Pick up where you left off, open the right workspace, or ask for contextual help. You remain in control of every action."
      actions={(
        <button
          type="button"
          className="guided-hub__header-action"
          aria-label="Ask Project Assistant from Guided Help"
          onClick={() => openAssistant({
            title: "Project Assistant · Guided Help",
            context: { role, source: "guided-help-header", suggestedPrompt: "Help me choose my next guided step." },
          })}
        >
          <MessageCircle aria-hidden="true" size={18} />
          Ask Project Assistant
        </button>
      )}
    >
      <main data-testid="guided-onboarding-page">
        <GuidedExperienceHub role={role} />
      </main>
    </ContractorPageSurface>
  );
}
