import React, { useMemo, useState } from "react";
import { FilePlus2, Mic, Square, Sparkles } from "lucide-react";

import {
  cancelConversationalCapture,
  confirmConversationalCapture,
  routeConversationalCapture,
} from "../../api/captures.js";
import { createVoiceService } from "../../lib/voiceService.js";
import { Button, Card, FormField, InlineAlert } from "../ui";

function artifactMetadata(files) {
  return files.map((file) => ({
    name: file.name,
    mime_type: file.type,
    size: file.size,
  }));
}

export default function ConversationalCapture({
  context = {},
  onSaved,
  onCancel,
  onHandoff,
  onChooseExplicit,
}) {
  const voice = useMemo(() => createVoiceService(), []);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const contextPayload = {
    ...(context.projectId ? { project_id: Number(context.projectId) } : {}),
    ...(context.milestoneId ? { milestone_id: Number(context.milestoneId) } : {}),
    ...(context.agreementId ? { agreement_id: Number(context.agreementId) } : {}),
  };

  function toggleVoice() {
    if (listening) {
      voice.stopListening();
      setListening(false);
      return;
    }
    setError("");
    voice.startListening({
      lang: "en-US",
      onStart: () => setListening(true),
      onResult: ({ transcript }) => {
        setText(transcript);
        setVoiceUsed(true);
      },
      onError: () => {
        setListening(false);
        setError("Voice is unavailable. Continue by typing.");
        setAnnouncement("Voice unavailable. Type what happened instead.");
      },
      onEnd: () => setListening(false),
    });
  }

  async function route() {
    setBusy("route");
    setError("");
    setAnnouncement("Project Assistant is reviewing the Capture description.");
    try {
      const response = await routeConversationalCapture({
        text,
        capture_method: voiceUsed ? "voice_transcript" : "typed",
        artifacts: artifactMetadata(files),
        ...contextPayload,
      });
      setResult(response);
      setSelectedProfile(response.recommended_profile || "");
      setAnnouncement(
        response.status === "unsupported"
          ? "That Capture workflow is unavailable."
          : response.status === "needs_information"
            ? "More information is needed."
            : "Capture suggestion ready."
      );
    } catch (reason) {
      setError(
        reason?.response?.data?.detail ||
          "Project Assistant could not route this Capture. Choose an explicit option instead."
      );
      setAnnouncement("Routing failed. Explicit Capture options remain available.");
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!selectedProfile) return;
    setBusy("confirm");
    setError("");
    try {
      const response = await confirmConversationalCapture(
        {
          attempt_id: result.attempt_id,
          expected_version: result.version,
          selected_profile: selectedProfile,
          confirmed: true,
          ...contextPayload,
        },
        files
      );
      if (response.status === "handoff") {
        setAnnouncement("Opening the existing Capture form with your context.");
        onHandoff(response.handoff);
      } else {
        setAnnouncement("Capture created.");
        onSaved(response.capture);
      }
    } catch (reason) {
      setError(
        reason?.response?.data?.detail ||
          "The Capture could not be created. Your description remains here."
      );
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    if (result?.attempt_id) {
      try {
        await cancelConversationalCapture({
          attempt_id: result.attempt_id,
          expected_version: result.version,
        });
      } catch {
        // Closing the local draft remains safe; no Capture exists before confirmation.
      }
    }
    onCancel();
  }

  if (result) {
    return (
      <div className="grid gap-4" data-testid="conversational-capture-confirmation">
        <div className="sr-only" aria-live="polite">{announcement}</div>
        <InlineAlert
          theme="operational"
          tone={result.status === "unsupported" ? "warning" : "info"}
        >
          {result.summary}
          {result.fallback_used ? " Deterministic suggestions are being used." : ""}
        </InlineAlert>
        {result.unsupported_intent ? (
          <Card theme="operational" padding="md">
            <h3 className="font-bold">Unavailable workflow</h3>
            <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
              {result.unsupported_intent}
            </p>
          </Card>
        ) : null}
        <fieldset className="grid gap-3">
          <legend className="font-bold">What Project Assistant understood</legend>
          {result.candidate_profiles.map((profile) => (
            <label
              key={profile.profile_key}
              className="flex min-h-14 cursor-pointer gap-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-3 focus-within:ring-2 focus-within:ring-[var(--mhb-border-focus)]"
              data-testid={`conversational-profile-${profile.profile_key}`}
            >
              <input
                type="radio"
                name="capture-profile"
                checked={selectedProfile === profile.profile_key}
                onChange={() => {
                  setSelectedProfile(profile.profile_key);
                  setAnnouncement(`${profile.display_name} selected.`);
                }}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  {profile.display_name}
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {profile.confidence_category} routing confidence
                  </span>
                </span>
                <span className="mt-1 block text-sm text-[var(--mhb-text-secondary)]">
                  {profile.description}
                </span>
                <span className="mt-1 block text-xs text-[var(--mhb-text-muted)]">
                  Next: {profile.destination}
                </span>
                {profile.evidence.map((item) => (
                  <span key={item} className="mt-1 block text-xs text-[var(--mhb-text-muted)]">
                    Why: {item}
                  </span>
                ))}
                {profile.warnings.map((item) => (
                  <span key={item} className="mt-1 block text-xs font-semibold text-amber-500">
                    {item}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </fieldset>
        {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
        <div className="sticky bottom-0 grid gap-2 border-t border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-card-elevated)] py-3 sm:flex sm:justify-end">
          <Button type="button" variant="ghost" theme="operational" onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" variant="ghost" theme="operational" onClick={() => setResult(null)}>
            Edit description
          </Button>
          <Button type="button" variant="secondary" theme="operational" onClick={onChooseExplicit}>
            Choose explicit form
          </Button>
          <Button
            type="button"
            theme="operational"
            loading={busy === "confirm"}
            disabled={!selectedProfile || result.status === "unsupported"}
            onClick={confirm}
          >
            Confirm and continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="conversational-capture">
      <div className="sr-only" aria-live="polite">{announcement}</div>
      <InlineAlert theme="operational" tone="info">
        Describe what happened. Project Assistant will suggest an existing Capture workflow for you to confirm.
      </InlineAlert>
      {context.projectId ? (
        <Card theme="operational" padding="sm">
          Current project context: Project #{context.projectId}
        </Card>
      ) : null}
      <FormField
        label="What happened?"
        helperText="Private to your company unless an existing reviewed workflow says otherwise."
        required
      >
        {(fieldProps) => (
          <textarea
            {...fieldProps}
            autoFocus
            rows={7}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-40 w-full resize-y rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 text-base text-[var(--mhb-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
            data-testid="conversational-text"
          />
        )}
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="secondary"
          theme="operational"
          icon={listening ? Square : Mic}
          onClick={toggleVoice}
          data-testid="conversational-voice"
        >
          {listening ? "Stop listening" : "Describe by voice"}
        </Button>
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--mhb-border-default)] px-3 font-bold focus-within:ring-2 focus-within:ring-[var(--mhb-border-focus)]">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Add photos or documents
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))}
            data-testid="conversational-files"
          />
        </label>
      </div>
      {files.length ? (
        <p className="text-sm text-[var(--mhb-text-secondary)]">
          {files.length} private artifact{files.length === 1 ? "" : "s"} selected.
        </p>
      ) : null}
      {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      <div className="grid gap-2 sm:flex sm:justify-end">
        <Button type="button" variant="ghost" theme="operational" onClick={cancel}>Cancel</Button>
        <Button type="button" variant="secondary" theme="operational" onClick={onChooseExplicit}>
          Choose an explicit Capture
        </Button>
        <Button
          type="button"
          theme="operational"
          icon={Sparkles}
          loading={busy === "route"}
          disabled={!text.trim() && !files.length}
          onClick={route}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
