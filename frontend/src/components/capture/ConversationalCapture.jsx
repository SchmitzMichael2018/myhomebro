import React, { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Mic, Search, Square, Sparkles, Trash2 } from "lucide-react";

import {
  cancelConversationalCapture,
  confirmConversationalCapture,
  followUpConversationalCapture,
  getCaptureProfiles,
  routeConversationalCapture,
  searchConversationalContexts,
} from "../../api/captures.js";
import { createVoiceService } from "../../lib/voiceService.js";
import { Button, Card, FormField, InlineAlert } from "../ui";
import {
  CONVERSATIONAL_CAPTURE_STATES as STATES,
  canTransitionConversationalCapture,
} from "./conversationalCaptureState.js";

function artifactMetadata(files) {
  return files.map((file) => ({
    name: file.name,
    mime_type: file.type,
    size: file.size,
  }));
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function groupProfiles(profiles) {
  return profiles.reduce((groups, profile) => {
    const group = profile.group || "General";
    groups[group] = [...(groups[group] || []), profile];
    return groups;
  }, {});
}

function ContextSearch({ type, projectId, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = await searchConversationalContexts({
          context_type: type,
          ...(query.trim().length >= 2 ? { q: query.trim() } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        });
        if (active) setRows(result);
      } catch {
        if (active) setError("Authorized context could not be loaded. Try again.");
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, query, type]);

  return (
    <Card theme="operational" padding="md">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">Choose {type}</h3>
        <Button type="button" size="sm" variant="ghost" theme="operational" onClick={onClose}>
          Back
        </Button>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Search authorized {type} records</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${type} records`}
          className="min-w-0 flex-1 bg-transparent outline-none"
          data-testid={`conversational-${type}-search`}
        />
      </label>
      {loading ? <p className="mt-3 text-sm" role="status">Loading authorized records…</p> : null}
      {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      {!loading && !error && !rows.length ? (
        <p className="mt-3 text-sm text-[var(--mhb-text-secondary)]">No authorized matches.</p>
      ) : null}
      <div className="mt-3 grid gap-2" role="listbox" aria-label={`Authorized ${type} records`}>
        {rows.map((row) => (
          <button
            key={`${type}-${row.id}`}
            type="button"
            role="option"
            aria-selected="false"
            onClick={() => onSelect(row)}
            className="min-h-14 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-3 text-left hover:bg-[var(--mhb-surface-interactive-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
          >
            <span className="block font-bold">{row.display_name}</span>
            <span className="block text-sm text-[var(--mhb-text-secondary)]">{row.secondary_text}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function ConversationalCapture({
  context = {},
  onSaved,
  onCancel,
  onHandoff,
  onChooseExplicit,
}) {
  const voice = useMemo(() => createVoiceService(), []);
  const requestSequence = useRef(0);
  const [stage, setStage] = useState(STATES.COMPOSING);
  const [text, setText] = useState(context.sourceText || "");
  const [files, setFiles] = useState(context.files || []);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedContext, setSelectedContext] = useState({
    ...(context.projectId ? { project_id: Number(context.projectId) } : {}),
    ...(context.milestoneId ? { milestone_id: Number(context.milestoneId) } : {}),
    ...(context.agreementId ? { agreement_id: Number(context.agreementId) } : {}),
  });
  const [contextLabels, setContextLabels] = useState({});
  const [contextSearchType, setContextSearchType] = useState("");
  const [answers, setAnswers] = useState({});
  const [profileChooser, setProfileChooser] = useState(false);
  const [profileQuery, setProfileQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  function transition(next) {
    if (canTransitionConversationalCapture(stage, next)) setStage(next);
  }

  useEffect(() => () => voice.cancelListening(), [voice]);

  useEffect(() => {
    getCaptureProfiles(selectedContext)
      .then((response) => setProfiles(response.profiles || []))
      .catch(() => setProfiles([]));
  }, [selectedContext]);

  function applyResponse(response) {
    setResult(response);
    setSelectedProfile(response.recommended_profile || selectedProfile);
    const next = response.status === "unsupported"
      ? STATES.UNSUPPORTED
      : response.status === "needs_information"
        ? STATES.NEEDS_INFORMATION
        : STATES.SUGGESTION;
    setStage(next);
    setAnnouncement(
      next === STATES.UNSUPPORTED
        ? "That workflow is unavailable."
        : next === STATES.NEEDS_INFORMATION
          ? "Project Assistant needs more information."
          : "Capture suggestion ready."
    );
  }

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
      onError: ({ code }) => {
        setListening(false);
        setError(
          code === "not-allowed"
            ? "Microphone permission was denied. Continue by typing."
            : "Voice is unavailable in this browser. Continue by typing."
        );
      },
      onEnd: () => setListening(false),
    });
  }

  async function route() {
    const sequence = ++requestSequence.current;
    transition(STATES.ROUTING);
    setBusy("route");
    setError("");
    setAnnouncement("Project Assistant is reviewing the description.");
    try {
      const response = await routeConversationalCapture({
        text,
        capture_method: voiceUsed ? "voice_transcript" : "typed",
        artifacts: artifactMetadata(files),
        ...selectedContext,
      });
      if (sequence === requestSequence.current) applyResponse(response);
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      setStage(STATES.FAILED);
      setError(
        reason?.response?.data?.detail
        || "Project Assistant could not route this Capture. Your work is preserved."
      );
    } finally {
      if (sequence === requestSequence.current) setBusy("");
    }
  }

  async function submitFollowUp() {
    const questions = result?.follow_up_questions || [];
    const payloadAnswers = questions
      .map((question) => ({
        question_key: question.question_key,
        value: answers[question.question_key]
          || (question.question_key === "profile" ? selectedProfile : ""),
      }))
      .filter((row) => row.value !== "");
    if (!payloadAnswers.length) {
      setError("Answer the required question before continuing.");
      return;
    }
    setBusy("follow-up");
    setError("");
    try {
      const response = await followUpConversationalCapture({
        attempt_id: result.attempt_id,
        expected_version: result.version,
        answers: payloadAnswers,
        selected_profile: selectedProfile,
        ...selectedContext,
      });
      applyResponse(response);
    } catch (reason) {
      const code = reason?.response?.data?.code;
      setError(
        code === "routing_version_conflict"
          ? "The suggestion changed. Your answers are preserved; route again to refresh it."
          : reason?.response?.data?.detail || "The answer could not be submitted. Try again."
      );
    } finally {
      setBusy("");
    }
  }

  function chooseContext(row) {
    const idKey = `${row.context_type}_id`;
    setSelectedContext((current) => {
      const next = { ...current, [idKey]: row.id };
      if (row.project_id) next.project_id = row.project_id;
      if (row.context_type === "project") {
        delete next.agreement_id;
        delete next.milestone_id;
      }
      return next;
    });
    setContextLabels((current) => ({ ...current, [row.context_type]: row.display_name }));
    setAnswers((current) => ({ ...current, [row.context_type]: String(row.id) }));
    setContextSearchType("");
    setStage(result?.status === "needs_information" ? STATES.NEEDS_INFORMATION : STATES.SUGGESTION);
    setAnnouncement(`${row.display_name} selected.`);
  }

  function selectProfile(key) {
    const profile = profiles.find((row) => row.profile_key === key)
      || result?.candidate_profiles?.find((row) => row.profile_key === key);
    setSelectedProfile(key);
    setAnswers((current) => ({ ...current, profile: key }));
    setProfileChooser(false);
    const required = profile?.required_context || [];
    if (!required.includes("agreement")) {
      setSelectedContext((current) => {
        const next = { ...current };
        delete next.agreement_id;
        return next;
      });
    }
    setAnnouncement(`${profile?.display_name || "Capture profile"} selected.`);
  }

  async function confirm() {
    if (!selectedProfile) return;
    setStage(STATES.CREATING);
    setBusy("confirm");
    setError("");
    try {
      const response = await confirmConversationalCapture(
        {
          attempt_id: result.attempt_id,
          expected_version: result.version,
          selected_profile: selectedProfile,
          confirmed: true,
          ...selectedContext,
        },
        files
      );
      if (response.status === "handoff") {
        setStage(STATES.HANDING_OFF);
        onHandoff({ ...response.handoff, files });
      } else {
        onSaved(response.capture);
      }
    } catch (reason) {
      setStage(STATES.CONFIRMING);
      setError(
        reason?.response?.data?.detail
        || "The Capture could not be created. Your description and files remain here."
      );
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    if ((text.trim() || files.length) && !window.confirm("Discard this conversational Capture draft?")) {
      return;
    }
    voice.cancelListening();
    if (result?.attempt_id) {
      try {
        await cancelConversationalCapture({
          attempt_id: result.attempt_id,
          expected_version: result.version,
        });
      } catch {
        // No Capture exists before confirmation; local close remains safe.
      }
    }
    onCancel();
  }

  const availableProfiles = profiles.filter((profile) => {
    const value = `${profile.display_name} ${profile.description}`.toLowerCase();
    return value.includes(profileQuery.toLowerCase());
  });
  const currentProfile = profiles.find((row) => row.profile_key === selectedProfile)
    || result?.candidate_profiles?.find((row) => row.profile_key === selectedProfile);

  if (contextSearchType) {
    return (
      <ContextSearch
        type={contextSearchType}
        projectId={selectedContext.project_id}
        onSelect={chooseContext}
        onClose={() => setContextSearchType("")}
      />
    );
  }

  if (stage === STATES.CONFIRMING || stage === STATES.CREATING) {
    return (
      <div className="grid gap-4" data-testid="conversational-final-confirmation">
        <div className="sr-only" aria-live="polite">{announcement}</div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--mhb-text-muted)]">Review</p>
          <h3 className="text-lg font-bold">Confirm this Capture</h3>
        </div>
        <Card theme="operational" padding="md">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-bold">Workflow</dt><dd>{currentProfile?.display_name}</dd></div>
            <div><dt className="font-bold">Destination</dt><dd>{currentProfile?.destination_key || "Private Capture"}</dd></div>
            <div><dt className="font-bold">Context</dt><dd>{contextLabels.project || (selectedContext.project_id ? `Project #${selectedContext.project_id}` : "No project")}</dd></div>
            <div><dt className="font-bold">Private artifacts</dt><dd>{files.length}</dd></div>
          </dl>
          <p className="mt-4 whitespace-pre-wrap text-sm">{text}</p>
        </Card>
        <InlineAlert theme="operational" tone="info">
          {currentProfile?.what_happens_next || "Creates a private Capture for review."}{" "}
          {currentProfile?.consequence_boundary || currentProfile?.non_effects}
        </InlineAlert>
        {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
        <div className="sticky bottom-0 grid gap-2 border-t border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-card-elevated)] py-3 sm:flex sm:justify-end">
          <Button type="button" variant="secondary" theme="operational" onClick={() => setStage(STATES.SUGGESTION)}>Back</Button>
          <Button type="button" theme="operational" loading={busy === "confirm"} onClick={confirm} data-testid="conversational-confirm-create">
            {currentProfile?.handoff_required ? "Open form to review" : "Create Capture for review"}
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    const questions = result.follow_up_questions || [];
    return (
      <div className="grid gap-4" data-testid="conversational-capture-confirmation">
        <div className="sr-only" aria-live="polite">{announcement}</div>
        <InlineAlert theme="operational" tone={stage === STATES.UNSUPPORTED ? "warning" : "info"}>
          {result.summary}
          {result.fallback_used ? " Deterministic suggestions are being used." : ""}
        </InlineAlert>
        {stage === STATES.UNSUPPORTED ? (
          <Card theme="operational" padding="md">
            <h3 className="font-bold">That workflow is not available</h3>
            <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{result.unsupported_intent}</p>
            <p className="mt-2 text-sm">You can save a private note or choose an existing Capture form. No record was created.</p>
          </Card>
        ) : null}
        {questions.length && stage === STATES.NEEDS_INFORMATION ? (
          <Card theme="operational" padding="md">
            <h3 className="font-bold">One more detail</h3>
            <div className="mt-3 grid gap-4">
              {questions.map((question) => (
                <FormField key={question.question_key} label={question.prompt || question.label} required={question.required} helperText={question.help_text}>
                  {(fieldProps) => question.context_type ? (
                    <Button type="button" variant="secondary" theme="operational" onClick={() => {
                      setContextSearchType(question.context_type);
                      setStage(STATES.SELECTING_CONTEXT);
                    }}>
                      {contextLabels[question.context_type] || `Choose ${question.context_type}`}
                    </Button>
                  ) : question.type === "profile_select" ? (
                    <Button type="button" variant="secondary" theme="operational" onClick={() => setProfileChooser(true)}>
                      {currentProfile?.display_name || "Choose workflow"}
                    </Button>
                  ) : (
                    <textarea
                      {...fieldProps}
                      rows={3}
                      maxLength={question.max_length || 500}
                      value={answers[question.question_key] || ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.question_key]: event.target.value }))}
                      className="w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3"
                    />
                  )}
                </FormField>
              ))}
            </div>
            <Button type="button" theme="operational" className="mt-4" loading={busy === "follow-up"} onClick={submitFollowUp}>
              Update suggestion
            </Button>
          </Card>
        ) : null}
        {profileChooser ? (
          <Card theme="operational" padding="md">
            <div className="flex items-center justify-between"><h3 className="font-bold">Choose another workflow</h3><Button type="button" variant="ghost" size="sm" theme="operational" onClick={() => setProfileChooser(false)}>Close</Button></div>
            <input value={profileQuery} onChange={(event) => setProfileQuery(event.target.value)} placeholder="Search available workflows" className="mt-3 min-h-11 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />
            <div className="mt-3 grid gap-4">
              {Object.entries(groupProfiles(availableProfiles)).map(([group, rows]) => (
                <section key={group}><h4 className="text-sm font-bold">{group}</h4><div className="mt-2 grid gap-2">{rows.map((profile) => (
                  <button key={profile.profile_key} type="button" onClick={() => selectProfile(profile.profile_key)} className="rounded-xl border border-[var(--mhb-border-default)] p-3 text-left">
                    <span className="block font-bold">{profile.display_name}</span><span className="block text-sm text-[var(--mhb-text-secondary)]">{profile.description}</span>
                  </button>
                ))}</div></section>
              ))}
            </div>
          </Card>
        ) : null}
        {!profileChooser && stage !== STATES.UNSUPPORTED ? (
          <fieldset className="grid gap-3">
            <legend className="font-bold">What Project Assistant understood</legend>
            {(result.candidate_profiles || []).map((profile) => (
              <label key={profile.profile_key} className="grid cursor-pointer gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-4 focus-within:ring-2 focus-within:ring-[var(--mhb-border-focus)]" data-testid={`conversational-profile-${profile.profile_key}`}>
                <span className="flex gap-3"><input type="radio" name="capture-profile" checked={selectedProfile === profile.profile_key} onChange={() => selectProfile(profile.profile_key)} /><span className="font-bold">{profile.display_name}</span><span className="rounded-full border px-2 py-0.5 text-xs">{profile.confidence_category} confidence</span></span>
                <span className="text-sm text-[var(--mhb-text-secondary)]">{profile.description}</span>
                <span className="text-xs"><strong>Next:</strong> {profile.what_happens_next || profile.destination}</span>
                {profile.evidence?.map((item) => <span key={item} className="text-xs text-[var(--mhb-text-muted)]"><strong>Why:</strong> {item}</span>)}
                <span className="text-xs text-amber-500">{profile.consequence_boundary || profile.warnings?.join(" ")}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {selectedContext.project_id ? (
          <Card theme="operational" padding="sm">
            <div className="flex items-center justify-between gap-3"><div><strong>Project context</strong><p className="text-sm text-[var(--mhb-text-secondary)]">{contextLabels.project || `Project #${selectedContext.project_id}`} · Scoped to an authorized record</p></div><Button type="button" variant="ghost" size="sm" theme="operational" onClick={() => setContextSearchType("project")}>Change</Button></div>
          </Card>
        ) : null}
        {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
        <div className="sticky bottom-0 grid gap-2 border-t border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-card-elevated)] py-3 sm:flex sm:flex-wrap sm:justify-end">
          <Button type="button" variant="ghost" theme="operational" onClick={cancel}>Cancel</Button>
          <Button type="button" variant="ghost" theme="operational" onClick={() => { setResult(null); setStage(STATES.COMPOSING); }}>Edit description</Button>
          <Button type="button" variant="secondary" theme="operational" onClick={() => setProfileChooser(true)}>Choose another</Button>
          <Button type="button" variant="secondary" theme="operational" onClick={onChooseExplicit}>Open explicit form</Button>
          <Button type="button" theme="operational" disabled={!selectedProfile || stage === STATES.UNSUPPORTED || stage === STATES.NEEDS_INFORMATION} onClick={() => setStage(STATES.CONFIRMING)}>Review selection</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="conversational-capture">
      <div className="sr-only" aria-live="polite">{announcement}</div>
      <InlineAlert theme="operational" tone="info">
        Describe what happened. Project Assistant suggests an existing workflow; you review every choice before anything is created.
      </InlineAlert>
      {selectedContext.project_id ? <Card theme="operational" padding="sm">Current project: {contextLabels.project || `Project #${selectedContext.project_id}`}</Card> : null}
      <FormField label="What happened?" helperText="Private to your company unless a reviewed workflow says otherwise." required>
        {(fieldProps) => <textarea {...fieldProps} autoFocus rows={7} value={text} onChange={(event) => setText(event.target.value)} className="min-h-40 w-full resize-y rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 text-base" data-testid="conversational-text" />}
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="secondary" theme="operational" icon={listening ? Square : Mic} onClick={toggleVoice} data-testid="conversational-voice" disabled={!voice.canListen()}>
          {listening ? "Stop listening" : voice.canListen() ? "Describe by voice" : "Voice unavailable"}
        </Button>
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--mhb-border-default)] px-3 font-bold focus-within:ring-2 focus-within:ring-[var(--mhb-border-focus)]"><FilePlus2 className="h-4 w-4" aria-hidden="true" />Add photos or documents<input type="file" multiple className="sr-only" onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 10))} data-testid="conversational-files" /></label>
      </div>
      {files.length ? <Card theme="operational" padding="sm"><p className="text-sm font-bold">Private attachments</p><ul className="mt-2 grid gap-2">{files.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex min-h-11 items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{file.name} · {formatBytes(file.size)} · pending confirmation</span><Button type="button" variant="icon" size="sm" theme="operational" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></li>)}</ul></Card> : null}
      {stage === STATES.FAILED && error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      <div className="grid gap-2 sm:flex sm:justify-end">
        <Button type="button" variant="ghost" theme="operational" onClick={cancel}>Cancel</Button>
        <Button type="button" variant="secondary" theme="operational" onClick={onChooseExplicit}>Choose explicit Capture</Button>
        <Button type="button" theme="operational" icon={Sparkles} loading={busy === "route"} disabled={!text.trim() && !files.length} onClick={route}>Continue</Button>
      </div>
    </div>
  );
}
