import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarClock, ChevronDown, ChevronUp, ExternalLink, Mail, MessageSquare, Mic, Send, ShieldCheck, Square, Volume2, X } from "lucide-react";

import api from "../api.js";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantCard,
  ProjectAssistantMissingInfoList,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "./ProjectAssistantExperience.jsx";
import {
  approvalActionForQuickCapture,
  draftRowsFromQuickCapture,
  normalizeProjectAssistantActions,
  PROJECT_ASSISTANT_ACTION_APPROVAL_LABELS,
  PROJECT_ASSISTANT_ACTION_LABELS,
  projectAssistantActionStatusLabel,
  quickCaptureIntentLabel,
} from "../lib/projectAssistantQuickCapture.js";
import {
  createVoiceService,
  loadVoiceSettings,
  rateForSpeechSetting,
  saveVoiceSettings,
  VOICE_STATES,
} from "../lib/voiceService.js";

function valueOrDash(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "-";
}

function DraftSection({ section, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const items = (section.items || []).filter(([_, value]) => value != null && String(value).trim() !== "");
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white" data-testid={`quick-capture-draft-${section.title.toLowerCase().replaceAll(" ", "-")}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-black text-slate-900">{section.title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>
      {open ? (
        <dl className="grid gap-2 border-t border-slate-100 px-4 py-3 text-sm">
          {items.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[130px_1fr]">
              <dt className="font-semibold text-slate-500">{label}</dt>
              <dd className="break-words text-slate-900">{valueOrDash(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function DuplicateMatches({ matches = [], selectedId, onSelect }) {
  const rows = Array.isArray(matches) ? matches.filter(Boolean) : [];
  if (!rows.length) return null;
  return (
    <ProjectAssistantSection title="Possible Customer Matches" testId="quick-capture-duplicates">
      <div className="grid gap-2">
        {rows.map((match) => (
          <button
            type="button"
            key={match.id}
            onClick={() => onSelect(match.id)}
            className={`min-h-[44px] rounded-lg border px-3 py-2 text-left ${
              String(selectedId || "") === String(match.id)
                ? "border-indigo-500 bg-indigo-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="font-semibold text-slate-900">{match.display_name}</div>
            <div className="mt-1 text-xs text-slate-600">
              {[match.phone, match.email, match.address].filter(Boolean).join(" | ")}
            </div>
          </button>
        ))}
      </div>
    </ProjectAssistantSection>
  );
}

const ACTION_ICONS = {
  schedule_estimate: CalendarClock,
  send_email: Mail,
  send_sms: MessageSquare,
  create_reminder: Bell,
  navigate: ExternalLink,
};

function actionDraftFields(actionType) {
  if (actionType === "schedule_estimate") {
    return [
      ["scheduled_start", "Estimate Date/Time", "text", "2026-08-01T15:00:00Z"],
      ["project_address", "Project Address", "text", ""],
      ["duration_minutes", "Duration Minutes", "number", ""],
      ["notes", "Notes", "textarea", ""],
    ];
  }
  if (actionType === "send_email") {
    return [
      ["recipient", "Recipient", "email", ""],
      ["subject", "Subject", "text", ""],
      ["body", "Email Body", "textarea", ""],
    ];
  }
  if (actionType === "send_sms") {
    return [
      ["recipient", "Phone", "tel", ""],
      ["body", "Text Message", "textarea", ""],
    ];
  }
  if (actionType === "create_reminder") {
    return [
      ["title", "Title", "text", ""],
      ["remind_at", "Reminder Date/Time", "text", "2026-08-02T14:00:00Z"],
      ["note", "Note", "textarea", ""],
    ];
  }
  return [];
}

function ProjectAssistantActionCard({ action, busy, onApprove }) {
  const actionType = action.action_type;
  const Icon = ACTION_ICONS[actionType] || ShieldCheck;
  const completed = action.status === "completed";
  const [draft, setDraft] = useState(action.prepared_payload || {});

  useEffect(() => {
    setDraft(action.prepared_payload || {});
  }, [action.action_id, action.updated_at]);

  const fields = actionDraftFields(actionType);
  const errors = Array.isArray(action.validation_errors) ? action.validation_errors : [];
  const warnings = Array.isArray(action.warnings) ? action.warnings : [];
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4" data-testid={`project-assistant-action-card-${actionType}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-800">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h4 className="text-sm font-black text-slate-950">{action.title || PROJECT_ASSISTANT_ACTION_LABELS[actionType]}</h4>
            <p className="mt-1 text-sm text-slate-600">{action.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                {projectAssistantActionStatusLabel(action.status)}
              </span>
              {action.requires_approval ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">
                  Requires Approval
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {completed ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
            Completed
          </span>
        ) : null}
      </div>

      {fields.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {fields.map(([key, label, type, placeholder]) => (
            <label key={key} className={type === "textarea" ? "grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2" : "grid gap-1 text-sm font-semibold text-slate-700"}>
              {label}
              {type === "textarea" ? (
                <textarea
                  value={draft[key] || ""}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  rows={3}
                  className="min-h-[88px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  data-testid={`project-assistant-action-field-${actionType}-${key}`}
                />
              ) : (
                <input
                  type={type}
                  value={draft[key] || ""}
                  placeholder={placeholder}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-3 text-sm font-normal"
                  data-testid={`project-assistant-action-field-${actionType}-${key}`}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      {actionType === "schedule_estimate" && Array.isArray(draft.availability_options) && draft.availability_options.length ? (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-950" data-testid="project-assistant-action-availability">
          <div className="font-black">Availability Found</div>
          <div className="mt-1">
            {draft.availability_options.slice(0, 3).map((slot) => (
              <span key={slot.id || `${slot.weekday}-${slot.start_time}`} className="mr-2 inline-block">
                Day {slot.weekday}: {slot.start_time}-{slot.end_time} {slot.timezone}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {errors.length ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" data-testid={`project-assistant-action-errors-${actionType}`}>
          Missing: {errors.map((row) => row.label || row.field).join(", ")}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid={`project-assistant-action-warnings-${actionType}`}>
          {warnings.join(" ")}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {actionType === "navigate" && draft.route ? (
          <a
            href={draft.route}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
            data-testid={`project-assistant-action-open-${actionType}`}
          >
            <ExternalLink className="h-4 w-4" />
            Open Workflow
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onApprove(action.action_id, draft)}
            disabled={busy || completed}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={`project-assistant-action-approve-${actionType}`}
          >
            <ShieldCheck className="h-4 w-4" />
            {PROJECT_ASSISTANT_ACTION_APPROVAL_LABELS[actionType] || "Approve"}
          </button>
        )}
      </div>
    </article>
  );
}

export default function ProjectAssistantQuickCapture({ compact = false, onClose = null }) {
  const voiceServiceRef = useRef(null);
  const [input, setInput] = useState("");
  const [session, setSession] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState(VOICE_STATES.IDLE);
  const [voiceError, setVoiceError] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings());

  const prepared = session?.prepared_payload || {};
  const missing = Array.isArray(prepared.missing_fields) ? prepared.missing_fields : [];
  const assumptions = Array.isArray(prepared.assumptions) ? prepared.assumptions : [];
  const safety = Array.isArray(prepared.safety_summary) ? prepared.safety_summary : [];
  const draftRows = useMemo(() => draftRowsFromQuickCapture(prepared), [prepared]);
  const approvalAction = approvalActionForQuickCapture(prepared);
  const preparedActions = normalizeProjectAssistantActions(session?.actions);

  const voiceService = useMemo(() => {
    if (!voiceServiceRef.current) {
      voiceServiceRef.current = createVoiceService();
    }
    return voiceServiceRef.current;
  }, []);

  useEffect(() => {
    return () => {
      voiceService.stopListening();
      voiceService.stopSpeaking();
    };
  }, [voiceService]);

  useEffect(() => {
    if (!voiceMode || voiceSettings.voiceResponses !== "always") return;
    const question = prepared.follow_up_question;
    if (!question) return;
    const shortPrompt = question.length > 180
      ? "I've prepared the draft. Please review it on screen."
      : question;
    voiceService.speak(shortPrompt, {
      rate: rateForSpeechSetting(voiceSettings.speechRate),
      onStart: () => setVoiceState(VOICE_STATES.SPEAKING),
      onEnd: () => setVoiceState(missing.length ? VOICE_STATES.WAITING : VOICE_STATES.APPROVAL_REQUIRED),
      onError: () => setVoiceState(missing.length ? VOICE_STATES.WAITING : VOICE_STATES.REVIEW_READY),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.updated_at, prepared.follow_up_question, voiceMode, voiceSettings.voiceResponses, voiceSettings.speechRate]);

  async function sendTurn(event) {
    event?.preventDefault?.();
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const response = session?.id
        ? await api.post(`/projects/project-assistant/quick-capture/sessions/${session.id}/`, { text })
        : await api.post("/projects/project-assistant/quick-capture/sessions/", { text });
      setSession(response.data);
      setInput("");
    } catch (err) {
      setError(err?.response?.data?.detail || "Project Assistant could not update the capture draft.");
    } finally {
      setBusy(false);
    }
  }

  function updateVoiceSettings(patch) {
    setVoiceSettings((current) => saveVoiceSettings({ ...current, ...patch }));
  }

  function startVoiceMode() {
    setVoiceMode(true);
    setVoiceError("");
    if (!voiceService.isSupported()) {
      setVoiceState(VOICE_STATES.ERROR);
      setVoiceError("Voice mode is not available in this browser. You can keep typing instead.");
      return;
    }
    if (voiceSettings.voiceResponses === "always") {
      voiceService.speak("Voice Mode is ready. Tell me what you would like to capture.", {
        rate: rateForSpeechSetting(voiceSettings.speechRate),
        onStart: () => setVoiceState(VOICE_STATES.SPEAKING),
        onEnd: () => setVoiceState(VOICE_STATES.WAITING),
        onError: () => setVoiceState(VOICE_STATES.WAITING),
      });
    } else {
      setVoiceState(VOICE_STATES.WAITING);
    }
  }

  function startListening() {
    setVoiceError("");
    setVoiceTranscript("");
    setVoiceState(VOICE_STATES.LISTENING);
    voiceService.startListening({
      onStart: () => setVoiceState(VOICE_STATES.LISTENING),
      onResult: ({ transcript, isFinal }) => {
        setVoiceTranscript(transcript);
        if (isFinal) setVoiceState(VOICE_STATES.REVIEW_READY);
      },
      onError: (err) => {
        setVoiceState(VOICE_STATES.ERROR);
        const code = err?.code || "";
        if (code === "not-allowed" || code === "permission-denied") {
          setVoiceError("Microphone permission was denied. You can keep typing instead.");
        } else if (code === "no-speech") {
          setVoiceError("No speech was detected. Try again or type the note.");
        } else {
          setVoiceError(err?.message || "Voice recognition failed. You can keep typing instead.");
        }
      },
      onEnd: () => {
        setVoiceState((current) => current === VOICE_STATES.LISTENING ? VOICE_STATES.WAITING : current);
      },
    });
  }

  function stopListening() {
    voiceService.stopListening();
    setVoiceState(voiceTranscript ? VOICE_STATES.REVIEW_READY : VOICE_STATES.WAITING);
  }

  function useTranscript() {
    if (!voiceTranscript.trim()) return;
    setInput(voiceTranscript.trim());
    setVoiceState(VOICE_STATES.PROCESSING);
  }

  function exitVoiceMode() {
    voiceService.stopListening();
    voiceService.stopSpeaking();
    setVoiceMode(false);
    setVoiceState(VOICE_STATES.IDLE);
    setVoiceError("");
  }

  async function approve(action) {
    if (!session?.id || !action) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/projects/project-assistant/quick-capture/sessions/${session.id}/approve/`, {
        action,
        selected_customer_id: selectedCustomerId || undefined,
      });
      setSession(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Project Assistant could not approve this draft.");
    } finally {
      setBusy(false);
    }
  }

  function replacePreparedAction(updatedAction) {
    setSession((current) => {
      if (!current) return current;
      const existing = normalizeProjectAssistantActions(current.actions);
      const next = existing.some((row) => row.action_id === updatedAction.action_id)
        ? existing.map((row) => row.action_id === updatedAction.action_id ? updatedAction : row)
        : [updatedAction, ...existing];
      return { ...current, actions: next };
    });
  }

  async function prepareNextAction(actionType) {
    if (!session?.id || !actionType) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/projects/project-assistant/quick-capture/sessions/${session.id}/actions/`, {
        action_type: actionType,
      });
      replacePreparedAction(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Project Assistant could not prepare that action.");
    } finally {
      setBusy(false);
    }
  }

  async function approvePreparedAction(actionId, preparedPayload) {
    if (!session?.id || !actionId) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/projects/project-assistant/quick-capture/sessions/${session.id}/actions/${actionId}/approve/`, {
        prepared_payload: preparedPayload,
      });
      replacePreparedAction(response.data);
    } catch (err) {
      const action = err?.response?.data?.action;
      if (action) replacePreparedAction(action);
      setError(err?.response?.data?.detail || "Project Assistant could not approve that action.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!session?.id) {
      setSession(null);
      setInput("");
      onClose?.();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/projects/project-assistant/quick-capture/sessions/${session.id}/cancel/`, {});
      setSession(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Project Assistant could not cancel this draft.");
    } finally {
      setBusy(false);
    }
  }

  const approved = session?.status === "approved";
  const cancelled = session?.status === "cancelled";

  return (
    <ProjectAssistantPanel
      testId="project-assistant-quick-capture"
      subtitle="Customer & Job Intake"
      summary="Type what you heard from a customer. Project Assistant prepares drafts, asks focused follow-ups, and waits for approval before saving anything."
      className={compact ? "h-full overflow-auto rounded-none border-0 shadow-none" : ""}
      actions={
        onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-black text-slate-700"
            aria-label="Close Project Assistant"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null
      }
    >
      <form onSubmit={sendTurn} className="grid gap-3" data-testid="quick-capture-form">
        <label className="text-sm font-black text-slate-900" htmlFor="quick-capture-input">
          Tell Project Assistant what happened
        </label>
        <textarea
          id="quick-capture-input"
          data-testid="quick-capture-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Example: I just spoke with Sarah Johnson. Her number is 214-555-0182. She wants a bathroom remodel at 123 Oak Street."
          rows={compact ? 4 : 3}
          disabled={busy || approved || cancelled}
          className="min-h-[118px] rounded-xl border border-slate-200 px-3 py-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={busy || !input.trim() || approved || cancelled}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="quick-capture-send"
          >
            <Send className="h-4 w-4" />
            {session ? "Send Follow-Up" : "Start Capture"}
          </button>
          <button
            type="button"
            onClick={voiceMode ? startListening : startVoiceMode}
            title="Open Voice Mode"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-500"
            data-testid="quick-capture-mic-button"
          >
            <Mic className="h-4 w-4" />
            {voiceMode ? "Listen" : "Voice Mode"}
          </button>
        </div>
      </form>

      {error ? (
        <ProjectAssistantCard title="Capture needs attention" tone="danger" testId="quick-capture-error">
          {error}
        </ProjectAssistantCard>
      ) : null}

      <ProjectAssistantSection title="Voice Mode" testId="quick-capture-voice-mode">
        <div className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-black text-slate-900">Microphone and spoken prompts</div>
              <p className="mt-1 text-sm text-slate-600">
                Voice is optional. Review the transcript before it updates the structured draft.
              </p>
            </div>
            <button
              type="button"
              onClick={voiceMode ? exitVoiceMode : startVoiceMode}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700"
              data-testid="quick-capture-voice-toggle"
            >
              <Mic className="h-4 w-4" />
              {voiceMode ? "Exit Voice Mode" : "Voice Mode"}
            </button>
          </div>

          {voiceMode ? (
            <div className="grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3" data-testid="quick-capture-voice-panel">
              <div className="flex flex-wrap gap-2 text-xs font-black text-indigo-950">
                <span data-testid="quick-capture-voice-state" className="rounded-full border border-indigo-200 bg-white px-3 py-1">
                  {voiceState.replaceAll("_", " ")}
                </span>
                {voiceService.isListening() ? <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">Listening</span> : null}
                {voiceService.isSpeaking() ? <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Speaking</span> : null}
              </div>

              {voiceError ? (
                <div className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-800" data-testid="quick-capture-voice-error">
                  {voiceError}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2" data-testid="quick-capture-voice-settings">
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Voice Responses
                  <select
                    value={voiceSettings.voiceResponses}
                    onChange={(event) => updateVoiceSettings({ voiceResponses: event.target.value })}
                    className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3"
                  >
                    <option value="off">Off</option>
                    <option value="tap_to_listen">Tap To Listen</option>
                    <option value="always">Always Speak During Voice Sessions</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Speech Rate
                  <select
                    value={voiceSettings.speechRate}
                    onChange={(event) => updateVoiceSettings({ speechRate: event.target.value })}
                    className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3"
                  >
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={startListening}
                  disabled={voiceState === VOICE_STATES.LISTENING}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                  data-testid="quick-capture-voice-listen"
                >
                  <Mic className="h-4 w-4" />
                  Start Listening
                </button>
                <button
                  type="button"
                  onClick={stopListening}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700"
                  data-testid="quick-capture-voice-stop"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => voiceService.speak(prepared.follow_up_question || "Please review the prepared draft on screen.", {
                    rate: rateForSpeechSetting(voiceSettings.speechRate),
                    onStart: () => setVoiceState(VOICE_STATES.SPEAKING),
                    onEnd: () => setVoiceState(VOICE_STATES.WAITING),
                  })}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700"
                  data-testid="quick-capture-voice-speak"
                >
                  <Volume2 className="h-4 w-4" />
                  Speak Prompt
                </button>
              </div>

              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Editable transcript
                <textarea
                  value={voiceTranscript}
                  onChange={(event) => setVoiceTranscript(event.target.value)}
                  rows={3}
                  className="min-h-[96px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  data-testid="quick-capture-voice-transcript"
                  placeholder="Recognized speech appears here. Edit it before using it."
                />
              </label>
              <button
                type="button"
                onClick={useTranscript}
                disabled={!voiceTranscript.trim()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                data-testid="quick-capture-use-transcript"
              >
                Use Edited Transcript
              </button>

              <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950" data-testid="quick-capture-driving-mode-note">
                Review and approve records on screen before continuing. Driving Mode is not active yet.
              </div>
            </div>
          ) : null}
        </div>
      </ProjectAssistantSection>

      {session ? (
        <>
          <ProjectAssistantCard title="Conversation" tone="info" testId="quick-capture-conversation">
            <div className="space-y-2 text-sm">
              {(session.conversation_payload?.turns || []).map((turn, index) => (
                <div key={`${turn.role}-${index}`} className="rounded-lg bg-white px-3 py-2">
                  <span className="font-semibold">{turn.role === "contractor" ? "You" : "Project Assistant"}:</span>{" "}
                  {turn.text}
                </div>
              ))}
              {prepared.follow_up_question ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 font-semibold text-indigo-950">
                  {prepared.follow_up_question}
                </div>
              ) : null}
            </div>
          </ProjectAssistantCard>

          <ProjectAssistantSection title="Prepared Record" testId="quick-capture-prepared-record">
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-black">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-indigo-800">
                {quickCaptureIntentLabel(prepared.intent)}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
                {session.status}
              </span>
            </div>
            <div className="grid gap-3">
              {draftRows.length ? draftRows.map((row) => <DraftSection key={row.title} section={row} defaultOpen={!compact} />) : (
                <div className="text-sm text-slate-500">No structured draft yet.</div>
              )}
            </div>
          </ProjectAssistantSection>

          <ProjectAssistantSection title="Missing Information" testId="quick-capture-missing">
            <ProjectAssistantMissingInfoList items={missing} empty="No missing required information." />
          </ProjectAssistantSection>

          {assumptions.length ? (
            <ProjectAssistantSection title="Assumptions" testId="quick-capture-assumptions">
              <ul className="grid gap-2">
                {assumptions.map((item) => (
                  <li key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2">{item}</li>
                ))}
              </ul>
            </ProjectAssistantSection>
          ) : null}

          <DuplicateMatches
            matches={prepared.possible_duplicates}
            selectedId={selectedCustomerId}
            onSelect={setSelectedCustomerId}
          />

          <ProjectAssistantApprovalNotice compact>
            Review before saving. No customer message, estimate appointment, agreement, project, assignment, invoice, or payment will be created automatically.
          </ProjectAssistantApprovalNotice>

          {safety.length ? (
            <ProjectAssistantSection title="If You Approve" testId="quick-capture-safety">
              <ul className="grid gap-1">
                {safety.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </ProjectAssistantSection>
          ) : null}

          <ProjectAssistantSection title="Suggested Next Steps" testId="project-assistant-action-hub">
            <div className="grid gap-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="project-assistant-action-hub-safety">
                Project Assistant can prepare next actions here, but scheduling, email, SMS, and reminders still require your visible approval.
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["schedule_estimate", "Schedule Estimate"],
                  ["send_email", "Prepare Email"],
                  ["send_sms", "Prepare Text"],
                  ["create_reminder", "Create Reminder"],
                  ["navigate", "Open Workflow"],
                ].map(([actionType, label]) => (
                  <button
                    key={actionType}
                    type="button"
                    onClick={() => prepareNextAction(actionType)}
                    disabled={busy || cancelled}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
                    data-testid={`project-assistant-prepare-action-${actionType}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {preparedActions.length ? (
                <div className="grid gap-3" data-testid="project-assistant-prepared-actions">
                  {preparedActions.map((action) => (
                    <ProjectAssistantActionCard
                      key={action.action_id}
                      action={action}
                      busy={busy}
                      onApprove={approvePreparedAction}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No next actions have been prepared yet.</div>
              )}
            </div>
          </ProjectAssistantSection>

          <div className="grid gap-2 sm:grid-cols-2" data-testid="quick-capture-actions">
            {approvalAction ? (
              <button
                type="button"
                onClick={() => approve(approvalAction.action)}
                disabled={busy || approved || cancelled}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="quick-capture-approve"
              >
                <ShieldCheck className="h-4 w-4" />
                {approvalAction.label}
              </button>
            ) : null}
            {selectedCustomerId && prepared.intent === "create_customer_and_opportunity" ? (
              <button
                type="button"
                onClick={() => approve("create_opportunity_for_existing_customer")}
                disabled={busy || approved || cancelled}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="quick-capture-use-existing"
              >
                Add Opportunity To Existing Customer
              </button>
            ) : null}
            <button
              type="button"
              onClick={cancel}
              disabled={busy || approved || cancelled}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="quick-capture-cancel"
            >
              Cancel Without Saving
            </button>
          </div>

          {approved ? (
            <ProjectAssistantCard title="Approved and saved" tone="success" testId="quick-capture-approved">
              Created records are linked in the capture audit. No message, appointment, agreement, project, assignment, invoice, or payment was created automatically.
            </ProjectAssistantCard>
          ) : null}
          {cancelled ? (
            <ProjectAssistantCard title="Draft cancelled" tone="default" testId="quick-capture-cancelled">
              The original note remains in the cancelled capture session for audit review.
            </ProjectAssistantCard>
          ) : null}
        </>
      ) : null}
    </ProjectAssistantPanel>
  );
}
