import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, CircleHelp, Compass, ExternalLink, MessageCircle, RotateCcw, Sparkles } from "lucide-react";
import { useAssistantDock } from "../AssistantDock.jsx";
import Modal from "../Modal";
import { useGuidedExperience } from "./GuidedExperience";
import {
  deriveGuidedProgress,
  getRecommendedStep,
  getRolePath,
  getWorkspaceGroups,
} from "./guidedExperienceModel";

function emitGuidedEvent(name, detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mhb:analytics", { detail: { event: name, ...detail } }));
}

function AssistantLink({ role, step: activeStep, compact = false }) {
  const { openAssistant } = useAssistantDock();
  const label = activeStep ? `Ask about ${activeStep.title.toLowerCase()}` : "Ask Project Assistant";
  return (
    <button
      type="button"
      className="guided-hub__secondary-action"
      onClick={() => {
        const context = {
          role,
          stepId: activeStep?.id || null,
          workspace: activeStep?.workspace || null,
          suggestedPrompt: activeStep
            ? `Help me with the next guided step: ${activeStep.title}.`
            : "Help me choose my next step.",
        };
        emitGuidedEvent("guided_assistant_opened", { role, step: activeStep?.id });
        openAssistant({
          title: activeStep ? `Project Assistant · ${activeStep.workspace}` : "Project Assistant · Guided Help",
          context,
        });
      }}
    >
      <MessageCircle aria-hidden="true" size={18} />
      {compact ? "Ask for help" : label}
    </button>
  );
}

export default function GuidedExperienceHub({ role }) {
  const navigate = useNavigate();
  const rolePath = useMemo(() => getRolePath(role), [role]);
  const [progress, setProgress] = useGuidedExperience(role);
  const derived = useMemo(() => deriveGuidedProgress(role, progress), [role, progress]);
  const recommended = getRecommendedStep(role, progress);
  const groups = useMemo(() => getWorkspaceGroups(role), [role]);
  const [dialog, setDialog] = useState(null);
  const dialogTrigger = useRef(null);

  useEffect(() => {
    emitGuidedEvent("guided_help_viewed", { role });
  }, [role]);

  const save = (next) => setProgress({ ...progress, ...next, role, updatedAt: new Date().toISOString() });

  const start = () => {
    save({ status: "active", stepIndex: derived.stepIndex });
    emitGuidedEvent(
      progress.status === "paused" || progress.status === "skipped" ? "guided_journey_resumed" : "guided_journey_started",
      { role, step: derived.currentStep?.id },
    );
  };

  const continueJourney = () => {
    if (derived.isComplete) {
      save({ status: "active", stepIndex: 0 });
      return;
    }
    start();
  };

  const completeStep = () => {
    const isLast = derived.stepIndex >= derived.total - 1;
    emitGuidedEvent("guided_step_completed", { role, step: derived.currentStep?.id });
    save({
      status: isLast ? "completed" : "active",
      stepIndex: isLast ? derived.stepIndex : derived.stepIndex + 1,
    });
    if (isLast) emitGuidedEvent("guided_journey_completed", { role });
  };

  const selectStep = (targetStep) => {
    const targetIndex = rolePath.steps.findIndex((item) => item.id === targetStep.id);
    save({ status: "active", stepIndex: targetIndex >= 0 ? targetIndex : derived.stepIndex });
    emitGuidedEvent("guided_step_opened", { role, step: targetStep.id });
  };

  const openWorkspace = (targetStep) => {
    selectStep(targetStep);
    emitGuidedEvent("guided_workspace_opened", { role, step: targetStep.id, workspace: targetStep.workspace });
    navigate(targetStep.route, {
      state: {
        fromGuidedHelp: true,
        guidedExperienceContext: { role, stepId: targetStep.id, workspace: targetStep.workspace },
      },
    });
  };

  const requestDialog = (kind, event) => {
    dialogTrigger.current = event.currentTarget;
    setDialog(kind);
  };

  const closeDialog = () => {
    setDialog(null);
    window.setTimeout(() => dialogTrigger.current?.focus(), 0);
  };

  const confirmDialog = () => {
    if (dialog === "skip") {
      save({ status: "skipped", stepIndex: derived.stepIndex });
      emitGuidedEvent("guided_journey_skipped", { role, step: derived.currentStep?.id });
    } else {
      save({ status: "not_started", stepIndex: 0 });
      emitGuidedEvent("guided_journey_restarted", { role });
    }
    closeDialog();
  };

  const statusLabel = derived.isComplete
    ? "Walkthrough complete"
    : progress.status === "active"
      ? "In progress"
      : progress.status === "paused"
        ? "Paused"
        : progress.status === "skipped"
          ? "Skipped for now"
          : "Ready for next step";

  return (
    <div className="guided-hub" data-testid="guided-experience-hub">
      <section className="guided-hub__summary" aria-labelledby="guided-summary-title">
        <div>
          <p className="guided-hub__eyebrow">Your guided experience</p>
          <h2 id="guided-summary-title">{rolePath.label} path</h2>
          <p>{rolePath.description}</p>
        </div>
        <div className="guided-hub__progress-card">
          <div className="guided-hub__progress-copy">
            <span>{statusLabel}</span>
          <strong aria-live="polite">{derived.completedCount} of {derived.total} walkthrough steps</strong>
          </div>
          <div
            className="guided-hub__progress-track"
            role="progressbar"
            aria-label="Guided walkthrough progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={derived.percentage}
          >
            <span style={{ width: `${derived.percentage}%` }} />
          </div>
          <small>Walkthrough progress only. Your workspace records determine operational readiness.</small>
          <button className="guided-hub__primary-action" type="button" onClick={continueJourney}>
            <Compass aria-hidden="true" size={18} />
            {derived.isComplete ? "Review the path" : progress.status === "active" ? "Continue guide" : "Start guide"}
          </button>
        </div>
      </section>

      {recommended ? (
        <section className="guided-hub__recommended" aria-labelledby="guided-next-title">
          <div className="guided-hub__recommended-icon"><Sparkles aria-hidden="true" size={22} /></div>
          <div className="guided-hub__recommended-copy">
            <p className="guided-hub__eyebrow">Recommended next</p>
            <h2 id="guided-next-title">{recommended.title}</h2>
            <p>{recommended.purpose}</p>
            <p className="guided-hub__missing"><strong>Focus:</strong> {recommended.missing}</p>
          </div>
          <div className="guided-hub__actions">
            <button className="guided-hub__primary-action" type="button" onClick={() => openWorkspace(recommended)}>
              Open {recommended.workspace}
              <ExternalLink aria-hidden="true" size={17} />
            </button>
            <AssistantLink role={role} step={recommended} compact />
          </div>
        </section>
      ) : (
        <section className="guided-hub__complete" aria-labelledby="guided-complete-title">
          <CheckCircle2 aria-hidden="true" size={30} />
          <div>
            <h2 id="guided-complete-title">Your guided path is complete</h2>
            <p>You reviewed the core workflow. Optional guides remain available; workspace records and permissions are still the source of truth.</p>
            <p className="guided-hub__missing"><strong>Recommended first action:</strong> Review the workspace that changes most often for your role. Completion does not certify business or regulatory readiness.</p>
          </div>
          <button className="guided-hub__secondary-action" type="button" onClick={(event) => requestDialog("restart", event)}>
            <RotateCcw aria-hidden="true" size={17} /> Review again
          </button>
        </section>
      )}

      <section className="guided-hub__journey" aria-labelledby="guided-journey-title">
        <div className="guided-hub__section-heading">
          <div>
            <p className="guided-hub__eyebrow">Role journey</p>
            <h2 id="guided-journey-title">One clear step at a time</h2>
          </div>
          <span>{rolePath.steps.length} stages</span>
        </div>

        {!derived.isComplete && (
          <article className="guided-hub__focus-card" data-testid="guided-current-step">
            <div className="guided-hub__step-number" aria-hidden="true">{derived.stepIndex + 1}</div>
            <div>
              <p className="guided-hub__eyebrow">Current walkthrough step</p>
              <h3>{derived.currentStep.title}</h3>
              <p>{derived.currentStep.purpose}</p>
              <p className="guided-hub__missing"><strong>Useful outcome:</strong> {derived.currentStep.missing}</p>
            </div>
            <div className="guided-hub__actions">
              <button className="guided-hub__primary-action" type="button" onClick={() => openWorkspace(derived.currentStep)}>
                Open workspace <ChevronRight aria-hidden="true" size={18} />
              </button>
              {derived.stepIndex > 0 ? (
                <button className="guided-hub__secondary-action" type="button" onClick={() => selectStep(rolePath.steps[derived.stepIndex - 1])}>
                  Previous step
                </button>
              ) : null}
              <button className="guided-hub__secondary-action" type="button" onClick={completeStep}>
                Mark walkthrough step reviewed
              </button>
            </div>
          </article>
        )}

        <ol className="guided-hub__stepper" aria-label={`${rolePath.label} guided stages`}>
          {rolePath.steps.map((item, index) => {
            const isCurrent = !derived.isComplete && index === derived.stepIndex;
            const isReviewed = derived.isComplete || index < derived.stepIndex;
            return (
              <li key={item.id} className={isCurrent ? "is-current" : isReviewed ? "is-reviewed" : ""} aria-current={isCurrent ? "step" : undefined}>
                <button type="button" onClick={() => openWorkspace(item)}>
                  <span>{isReviewed ? <CheckCircle2 aria-hidden="true" size={19} /> : index + 1}</span>
                  <span><strong>{item.title}</strong><small>{item.workspace}</small></span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="guided-hub__journey-controls">
          {progress.status === "active" ? (
            <button className="guided-hub__text-action" type="button" onClick={() => save({ status: "paused", stepIndex: derived.stepIndex })}>Pause and resume later</button>
          ) : null}
          <button className="guided-hub__text-action" type="button" onClick={(event) => requestDialog("skip", event)}>Skip this guide</button>
          <button className="guided-hub__text-action" type="button" onClick={(event) => requestDialog("restart", event)}>Restart walkthrough</button>
        </div>
      </section>

      <section className="guided-hub__workspaces" aria-labelledby="guided-workspaces-title">
        <div className="guided-hub__section-heading">
          <div>
            <p className="guided-hub__eyebrow">Workspace guides</p>
            <h2 id="guided-workspaces-title">Help where you work</h2>
          </div>
          <AssistantLink role={role} />
        </div>
        <div className="guided-hub__workspace-groups">
          {groups.map((group, groupIndex) => (
            <details key={group.title} open={groupIndex === 0}>
              <summary>{group.title}<span>{group.steps.length}</span></summary>
              <div className="guided-hub__workspace-grid">
                {group.steps.map((item) => (
                  <article key={item.id}>
                    <h3>{item.workspace}</h3>
                    <p>{item.purpose}</p>
                    <div>
                      <button type="button" onClick={() => openWorkspace(item)}>Open workspace</button>
                      <button type="button" onClick={() => selectStep(item)}>Start walkthrough</button>
                      <AssistantLink role={role} step={item} compact />
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="guided-hub__help" aria-labelledby="guided-help-title">
        <div className="guided-hub__section-heading">
          <div>
            <p className="guided-hub__eyebrow">Help and support</p>
            <h2 id="guided-help-title">Answers without leaving your workflow</h2>
          </div>
          <CircleHelp aria-hidden="true" size={24} />
        </div>
        <details>
          <summary>Does walkthrough progress change my real project data?</summary>
          <p>No. It only remembers where you are in this guide. Workspace records, permissions, approvals, and audit history remain authoritative.</p>
        </details>
        <details>
          <summary>Can I return after opening a workspace?</summary>
          <p>Yes. Your current role and walkthrough step are saved on this device, so returning to Guided Help resumes the same context.</p>
        </details>
        <details>
          <summary>What if an action is unavailable?</summary>
          <p>Your role and assigned permissions still control each workspace. Ask Project Assistant for context or use your role’s support page for account access questions.</p>
        </details>
      </section>

      <Modal
        visible={Boolean(dialog)}
        onClose={closeDialog}
        title={dialog === "skip" ? "Skip this guide?" : "Restart this walkthrough?"}
        containerClassName="max-w-lg"
      >
        <div className="guided-hub__dialog">
          <p>
            {dialog === "skip"
              ? "This hides the recommendation for now without marking any workspace work complete. You can restart whenever you are ready."
              : "This resets walkthrough progress to the first step. It does not change projects, records, permissions, or completed business work."}
          </p>
          <div className="guided-hub__actions">
            <button className="guided-hub__secondary-action" type="button" onClick={closeDialog}>Cancel</button>
            <button className="guided-hub__primary-action" type="button" onClick={confirmDialog}>
              {dialog === "skip" ? "Skip for now" : "Restart walkthrough"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
